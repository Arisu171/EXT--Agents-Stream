
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { calculateHunks } from './hunkCalculator';
import { detectEol, fromLf, toLf } from './eol';
import { exceedsLineLimit } from '../watcher/fileSizeLimit';
import { looksBinary } from '../watcher/fileTypeRules';
import { DIFF_EDITOR_VIEW_TYPE } from './diffWebviewPanel';
import { SnapshotStore, SnapshotState } from './snapshotStore';
import { sortLikePendingTree } from './treeOrder';
import { coalesce } from '../utils/coalesce';

function normalizePath(filePath: string): string {
  const fsPath = vscode.Uri.file(path.resolve(filePath)).fsPath;
  return process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;
}

function canonicalCasePath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

export class DiffManager {
  private _onDidChangeDiffs = new vscode.EventEmitter<void>();
  public readonly onDidChangeDiffs = this._onDidChangeDiffs.event;

  private snapshots: Map<string, SnapshotState> = new Map();
  private pendingOrder: { display: string[]; index: Map<string, number> } | undefined;
  private displayPaths: Map<string, string> = new Map();
  private readonly store: SnapshotStore;
  private readonly saveSoon = coalesce(() => this.saveNow());
  private savePending = false;
  private lastSaveAt = 0;
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private lastCursors: Map<string, { line: number; column: number; topLine?: number }> = new Map();

  private pendingActiveTabPath: string | undefined;
  private pendingActiveTabCaptured = false;
  private pendingActiveTabCapturedAt = 0;
  private static readonly PENDING_ACTIVE_TAB_TTL_MS = 15000;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new SnapshotStore(context.workspaceState);
    this.snapshots = this.store.load();
  }

  async snapshotBefore(filePath: string): Promise<void> {
    const absPath = normalizePath(filePath);
    if (this.snapshots.has(absPath)) {
      return;
    }
    const uri = vscode.Uri.file(absPath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (err) {
      if (isFileNotFound(err)) {
        this.setSnapshot(absPath,{ content: '', fileExistedBefore: false });
        this.rememberDisplayPath(filePath);
        this.scheduleSave();
      }
      return;
    }

    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (looksBinary(content) || exceedsLineLimit(content)) { return; }
      this.setSnapshot(absPath,{ content, fileExistedBefore: true });
      this.rememberDisplayPath(filePath);
    } catch {
      return;
    }
    this.scheduleSave();
  }

  async openDiff(filePath: string, options?: { preserveFocus?: boolean }): Promise<void> {
    const absPath = normalizePath(filePath);
    const snapshot = this.snapshots.get(absPath);
    if (snapshot === undefined) { return; }

    let modifiedContent: string;
    try {
      modifiedContent = Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))
      ).toString('utf8');
    } catch {
      return;
    }

    const hunks = calculateHunks(toLf(snapshot.content), toLf(modifiedContent));
    if (hunks.length === 0) {
      if (!snapshot.fileExistedBefore) { return; }
      this.deleteSnapshot(absPath);
      this.scheduleSave();
      this._onDidChangeDiffs.fire();
      return;
    }

    const preserveFocus = options?.preserveFocus === true;

    const existing = this.panels.get(absPath);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Active, preserveFocus);
      this._onDidChangeDiffs.fire();
      return;
    }

    await this.closeTextTabsFor(absPath);

    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(canonicalCasePath(absPath)),
      DIFF_EDITOR_VIEW_TYPE,
      { preview: false, preserveFocus } satisfies vscode.TextDocumentShowOptions
    );
    this._onDidChangeDiffs.fire();
  }

  private async closeTextTabsFor(absPath: string): Promise<void> {
    await this.closeTextTabsForAll(new Set([absPath]));
  }

  private async closeTextTabsForAll(absPaths: ReadonlySet<string>): Promise<void> {
    const targets: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) { continue; }
        if (absPaths.has(normalizePath(tab.input.uri.fsPath))) {
          if (tab.isDirty) { continue; }
          targets.push(tab);
        }
      }
    }
    if (targets.length === 0) { return; }
    try {
      await vscode.window.tabGroups.close(targets);
    } catch (err) {
      console.error('[agents-check] closeTextTabsFor failed:', err);
    }
  }

  loadSnapshot(filePath: string, content: string, fileExistedBefore = true): void {
    const absPath = normalizePath(filePath);
    if (!this.snapshots.has(absPath)) {
      this.setSnapshot(absPath,{ content, fileExistedBefore });
      this.rememberDisplayPath(filePath);
      this.scheduleSave();
      this._onDidChangeDiffs.fire();
    }
  }

  async accept(filePath: string): Promise<void> {
    const absPath = normalizePath(filePath);
    if (!this.snapshots.has(absPath)) { return; }

    this.deleteSnapshot(absPath);
    this.saveNow();
    this.closePanel(absPath);
    this.lastCursors.delete(absPath);
    this._onDidChangeDiffs.fire();
  }

  async revert(filePath: string): Promise<void> {
    const absPath = normalizePath(filePath);
    const snapshot = this.snapshots.get(absPath);
    if (!snapshot) { return; }

    if (snapshot.fileExistedBefore) {
      await this.writeFile(absPath, snapshot.content);
    } else {
      await this.deleteFile(absPath);
    }

    this.deleteSnapshot(absPath);
    this.saveNow();
    this.closePanel(absPath);
    if (snapshot.fileExistedBefore) {
      await this.reopenAsTextEditor(absPath);
    } else {
      this.lastCursors.delete(absPath);
    }

    this._onDidChangeDiffs.fire();
  }

  async forgetDeleted(paths: string[]): Promise<number> {
    const roots = paths.map(normalizePath);
    const isUnder = (key: string): boolean => roots.some((root) =>
      key === root || key.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
    const dirty = new Set(vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty)
      .map((doc) => normalizePath(doc.uri.fsPath)));

    const forgotten = new Set<string>();
    for (const key of this.snapshots.keys()) {
      if (!isUnder(key) || dirty.has(key) || fs.existsSync(key)) { continue; }
      forgotten.add(key);
    }
    if (forgotten.size === 0) { return 0; }

    for (const key of forgotten) {
      this.deleteSnapshot(key);
      this.closePanel(key);
      this.lastCursors.delete(key);
      this.displayPaths.delete(key);
    }
    this.saveNow();
    await this.closeTextTabsForAll(forgotten);
    this._onDidChangeDiffs.fire();
    return forgotten.size;
  }

  async acceptAllPending(underRoot?: string): Promise<number> {
    if (!underRoot) {
      const pendingFiles = this.getPendingFiles();
      const count = pendingFiles.length;
      this.clearSnapshots();
      this.displayPaths.clear();
      this.saveNow();
      for (const p of pendingFiles) {
        this.closePanel(normalizePath(p));
      }
      this._onDidChangeDiffs.fire();
      return count;
    }
    const scoped = await this.getPendingSummaries(underRoot);
    let count = 0;
    for (const file of scoped) {
      await this.accept(file.path);
      count += 1;
    }
    return count;
  }

  hasPendingDiff(filePath: string): boolean {
    return this.snapshots.has(normalizePath(filePath));
  }

  getPendingFiles(): string[] {
    return this.getPendingOrder().display.slice();
  }

  getPendingIndex(filePath: string): number {
    return this.getPendingOrder().index.get(normalizePath(filePath)) ?? -1;
  }

  getPendingCount(): number {
    return this.snapshots.size;
  }

  async getPendingSummaries(underRoot?: string): Promise<Array<{
    path: string;
    name: string;
    relativePath: string;
    additions: number;
    deletions: number;
  }>> {
    const rootFs = underRoot && underRoot.trim()
      ? vscode.Uri.file(underRoot.trim()).fsPath
      : undefined;
    const rootNorm = rootFs
      ? (process.platform === 'win32' ? rootFs.replace(/[/\\]+$/, '').toLowerCase() : rootFs.replace(/[/\\]+$/, ''))
      : undefined;
    const out: Array<{
      path: string;
      name: string;
      relativePath: string;
      additions: number;
      deletions: number;
    }> = [];
    for (const displayPath of this.getPendingFiles()) {
      const absPath = normalizePath(displayPath);
      if (rootNorm) {
        const fileNorm = process.platform === 'win32' ? absPath.toLowerCase() : absPath;
        const under =
          fileNorm === rootNorm
          || fileNorm.startsWith(rootNorm + path.sep)
          || fileNorm.startsWith(rootNorm + '/');
        if (!under) {
          continue;
        }
      }
      const snapshot = this.snapshots.get(absPath);
      if (!snapshot) {
        continue;
      }
      let current = '';
      try {
        current = Buffer.from(
          await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))
        ).toString('utf8');
      } catch {
        current = '';
      }
      let additions = 0;
      let deletions = 0;
      try {
        const hunks = calculateHunks(toLf(snapshot.content), toLf(current));
        for (const hunk of hunks) {
          additions += hunk.addedLines.length;
          deletions += hunk.removedLines.length;
        }
      } catch {
      }
      const name = path.basename(displayPath);
      let relativePath = name;
      if (rootFs) {
        relativePath = path.relative(rootFs, displayPath) || name;
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
        if (folder) {
          relativePath = path.relative(folder.uri.fsPath, displayPath) || name;
        }
      }
      out.push({
        path: displayPath,
        name,
        relativePath: relativePath.split(path.sep).join('/'),
        additions,
        deletions,
      });
    }
    return out;
  }

  getPendingFileAt(index: number): string | undefined {
    return this.getPendingOrder().display[index];
  }

  private getPendingOrder(): { display: string[]; index: Map<string, number> } {
    if (!this.pendingOrder) {
      const keyByDisplay = new Map<string, string>();
      for (const key of this.snapshots.keys()) {
        keyByDisplay.set(this.getDisplayPath(key), key);
      }
      const display = sortLikePendingTree(Array.from(keyByDisplay.keys()));
      const index = new Map(display.map((p, i): [string, number] => [keyByDisplay.get(p)!, i]));
      this.pendingOrder = { display, index };
    }
    return this.pendingOrder;
  }

  flushPendingSave(): void {
    if (this.savePending) { this.saveNow(); }
  }

  private scheduleSave(): void {
    if (!this.savePending && Date.now() - this.lastSaveAt >= 500) {
      this.saveNow();
      return;
    }
    this.savePending = true;
    this.saveSoon.schedule();
  }

  private saveNow(): void {
    this.saveSoon.dispose();
    this.savePending = false;
    this.lastSaveAt = Date.now();
    void this.store.save(this.snapshots);
  }

  private setSnapshot(absPath: string, snapshot: SnapshotState): void {
    if (!this.snapshots.has(absPath)) { this.pendingOrder = undefined; }
    this.snapshots.set(absPath, snapshot);
  }

  private deleteSnapshot(absPath: string): void {
    this.snapshots.delete(absPath);
    this.pendingOrder = undefined;
  }

  private clearSnapshots(): void {
    this.snapshots.clear();
    this.pendingOrder = undefined;
  }

  getDisplayPath(filePath: string): string {
    const key = normalizePath(filePath);
    const known = this.displayPaths.get(key);
    if (known) { return known; }
    const onDisk = canonicalCasePath(key);
    const display = normalizePath(onDisk) === key ? onDisk : key;
    if (display !== key) { this.displayPaths.set(key, display); }
    return display;
  }

  private rememberDisplayPath(filePath: string): void {
    const key = normalizePath(filePath);
    const resolved = path.resolve(filePath);
    if (resolved !== key && normalizePath(resolved) === key) { this.displayPaths.set(key, resolved); }
  }

  getSnapshot(filePath: string): string | undefined {
    return this.snapshots.get(normalizePath(filePath))?.content;
  }

  getSnapshotContent(filePath: string): string | undefined {
    return this.getSnapshot(filePath);
  }

  setLastCursor(filePath: string, line: number, column: number, topLine?: number): void {
    this.lastCursors.set(normalizePath(filePath), { line, column, topLine });
  }

  getActiveFilePath(): string | undefined {
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (active?.input instanceof vscode.TabInputCustom) {
      if (active.input.viewType === DIFF_EDITOR_VIEW_TYPE) {
        return normalizePath(active.input.uri.fsPath);
      }
    }
    const first = this.panels.keys().next();
    return first.done ? undefined : first.value;
  }

  disposeAll(): void {
    this.clearSnapshots();
    this.displayPaths.clear();
    this.lastCursors.clear();
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }

  async clearAll(): Promise<void> {
    const hint = this.consumePendingActiveTabHint();
    const activeDiffPath = hint.captured
      ? (hint.path !== undefined && this.snapshots.has(hint.path) ? hint.path : undefined)
      : this.getLiveActiveDiffPath();

    this.disposeAll();
    this.saveSoon.dispose();
    this.savePending = false;
    await this.store.clear();
    this._onDidChangeDiffs.fire();

    if (activeDiffPath) {
      await this.reopenAsTextEditor(activeDiffPath);
    }
  }

  private getLiveActiveDiffPath(): string | undefined {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return activeTab?.input instanceof vscode.TabInputCustom &&
      activeTab.input.viewType === DIFF_EDITOR_VIEW_TYPE &&
      this.panels.has(normalizePath(activeTab.input.uri.fsPath))
        ? normalizePath(activeTab.input.uri.fsPath)
        : undefined;
  }

  markActiveTabBeforeAutoOpen(): void {
    this.pendingActiveTabPath = this.getCurrentTabFsPath();
    this.pendingActiveTabCaptured = true;
    this.pendingActiveTabCapturedAt = Date.now();
  }

  private getCurrentTabFsPath(): string | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri =
      tab?.input instanceof vscode.TabInputText ? tab.input.uri :
      tab?.input instanceof vscode.TabInputCustom ? tab.input.uri :
      tab?.input instanceof vscode.TabInputNotebook ? tab.input.uri :
      undefined;
    return uri ? normalizePath(uri.fsPath) : undefined;
  }

  private consumePendingActiveTabHint(): { captured: boolean; path: string | undefined } {
    const captured = this.pendingActiveTabCaptured;
    const path = this.pendingActiveTabPath;
    const capturedAt = this.pendingActiveTabCapturedAt;
    this.pendingActiveTabCaptured = false;
    this.pendingActiveTabPath = undefined;
    this.pendingActiveTabCapturedAt = 0;
    if (!captured || Date.now() - capturedAt > DiffManager.PENDING_ACTIVE_TAB_TTL_MS) {
      return { captured: false, path: undefined };
    }
    return { captured, path };
  }

  registerPanel(filePath: string, panel: vscode.WebviewPanel): void {
    const absPath = normalizePath(filePath);

    if (!this.snapshots.has(absPath)) {
      panel.dispose();
      return;
    }

    const existing = this.panels.get(absPath);
    if (existing && existing !== panel) {
      existing.dispose();
    }
    this.panels.set(absPath, panel);
  }

  unregisterPanel(filePath: string, panel: vscode.WebviewPanel): void {
    const absPath = normalizePath(filePath);
    const existing = this.panels.get(absPath);
    if (existing === panel) {
      this.panels.delete(absPath);
      this._onDidChangeDiffs.fire();
    }
  }

  private closePanel(absPath: string): void {
    const panel = this.panels.get(absPath);
    if (panel) {
      this.panels.delete(absPath);
      panel.dispose();
    }
  }

  private async reopenAsTextEditor(absPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    } catch (err) {
      if (!isFileNotFound(err)) {
        console.error('[agents-check] cannot stat file before reopening:', err);
      }
      this.lastCursors.delete(absPath);
      return;
    }
    const cursor = this.lastCursors.get(absPath);
    this.lastCursors.delete(absPath);
    const uri = vscode.Uri.file(canonicalCasePath(absPath));
    const showOptions: vscode.TextDocumentShowOptions = { preview: false };
    if (cursor) {
      const pos = new vscode.Position(
        Math.max(0, cursor.line - 1),
        Math.max(0, cursor.column - 1)
      );
      showOptions.selection = new vscode.Range(pos, pos);
    }
    try {
      const editor = await vscode.window.showTextDocument(uri, showOptions);
      if (cursor?.topLine !== undefined) {
        const lastLine = Math.max(0, editor.document.lineCount - 1);
        const top = Math.min(lastLine, Math.max(0, cursor.topLine - 1));
        editor.revealRange(
          new vscode.Range(top, 0, top, 0),
          vscode.TextEditorRevealType.AtTop
        );
      }
    } catch (err) {
      console.error('[agents-check] reopenAsTextEditor failed:', err);
    }
  }

  async applyHunkAcceptFromWebview(
    filePath: string,
    newOriginal: string,
    newCurrent: string
  ): Promise<void> {
    const absPath = normalizePath(filePath);
    const snapshot = this.snapshots.get(absPath);
    if (!snapshot) { return; }

    this.setSnapshot(absPath,{
      ...snapshot,
      content: fromLf(newOriginal, detectEol(snapshot.content)),
    });
    this.saveNow();

    if (newOriginal === newCurrent) {
      await this.accept(absPath);
    } else {
      this._onDidChangeDiffs.fire();
    }
  }

  async applyHunkRejectFromWebview(
    filePath: string,
    newOriginal: string,
    newCurrent: string
  ): Promise<void> {
    const absPath = normalizePath(filePath);
    const snapshot = this.snapshots.get(absPath);
    if (!snapshot) { return; }

    await this.writeFile(absPath, newCurrent, { fromLf: true });

    if (newOriginal === newCurrent) {
      if (!snapshot.fileExistedBefore && newCurrent.length === 0) {
        await this.deleteFile(absPath);
      }
      this.deleteSnapshot(absPath);
      this.saveNow();
      this.closePanel(absPath);
    }
    this._onDidChangeDiffs.fire();
  }

  private async writeFile(
    absPath: string,
    content: string,
    opts?: { fromLf?: boolean }
  ): Promise<void> {
    const uri = vscode.Uri.file(absPath);
    const doc = vscode.workspace.textDocuments.find(d => normalizePath(d.uri.fsPath) === absPath);

    let payload = content;
    if (opts?.fromLf) {
      let eol: '\r\n' | '\n';
      if (doc) {
        eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      } else {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          eol = detectEol(Buffer.from(bytes).toString('utf8'));
        } catch {
          eol = '\n';
        }
      }
      payload = fromLf(content, eol);
    }

    if (doc) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        doc.lineAt(doc.lineCount - 1).range.end
      );
      edit.replace(uri, fullRange, payload);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf8'));
    }
  }

  private async deleteFile(absPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(absPath));
    } catch (err) {
      if (!isFileNotFound(err)) {
        throw err;
      }
    }
  }
}
