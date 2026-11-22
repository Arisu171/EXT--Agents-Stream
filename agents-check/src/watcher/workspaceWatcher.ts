
import * as vscode from 'vscode';
import * as path from 'path';
import { DiffManager } from '../check/diffManager';
import { BaselineScanner } from './baselineScanner';
import { BaselineStore } from './baselineStore';
import { isTextFile, looksBinary } from './fileTypeRules';
import { isExcludedPathSegment } from './pathExclusions';
import { exceedsLineLimit, exceedsSizeLimitByBytes } from './fileSizeLimit';
import { BurstMeterConfig, WriteBurstMeter } from './writeBurstMeter';

interface ExternalWriteOptions {
  burstHoldOverride?: boolean;
  readDelayMs?: number;
}

export class WorkspaceWatcher {
  private disposables: vscode.Disposable[] = [];
  private lastProcessed = new Map<string, number>();
  private savedFilesByVsCode = new Map<string, number>();
  private readonly snapshots: BaselineStore;
  private readonly baselineScanner: BaselineScanner;
  private readonly pendingTimers = new Set<NodeJS.Timeout>();
  private readonly pendingDirectoryScans = new Map<string, NodeJS.Timeout>();
  private static readonly DIRECTORY_SETTLE_MS = 300;
  private readonly pendingDeletes = new Set<string>();
  private deleteSettleTimer: NodeJS.Timeout | undefined;
  private static readonly DELETE_SETTLE_MS = 300;
  private static readonly LAST_PROCESSED_TTL_MS = 60_000;
  private static readonly SAVED_BY_VSCODE_TTL_MS = 10_000;
  private suppressUntil = 0;
  private readonly burstMeter = new WriteBurstMeter();
  private baselineScansInProgress = 0;
  private readonly queuedExternalWrites = new Map<string, { burstHold: boolean; readDelayMs: number }>();
  private holdMs = 2000;
  private readonly heldWrites = new Map<string, { originalContent: string; newContent: string; fileExistedBefore: boolean }>();
  private holdResolveTimer: NodeJS.Timeout | undefined;
  private lastAutoOpenActivityAt = 0;
  private static readonly ACTIVE_TAB_CAPTURE_GAP_MS = 500;

  constructor(
    private readonly diffManager: DiffManager,
  ) {
    this.snapshots = new BaselineStore();
    this.baselineScanner = new BaselineScanner(this.snapshots);
  }

  start(): void {
    this.watchVscodeEvents();
    this.watchWorkspaceFolders();
    this.applyBurstConfig();
    const d = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agents-check.burstDetectionEnabled') ||
          e.affectsConfiguration('agents-check.burstDetectionWindowMs') ||
          e.affectsConfiguration('agents-check.burstDetectionThreshold') ||
          e.affectsConfiguration('agents-check.burstDetectionHoldMs')) {
        this.applyBurstConfig();
      }
    });
    this.disposables.push(d);
  }

  private applyBurstConfig(): void {
    this.burstMeter.updateConfig(this.loadBurstMeterConfig());
    const config = vscode.workspace.getConfiguration('agents-check');
    const holdMs = config.get<number>('burstDetectionHoldMs', 2000);
    this.holdMs = Number.isFinite(holdMs) ? Math.min(10000, Math.max(500, holdMs)) : 2000;
  }

  private loadBurstMeterConfig(): BurstMeterConfig {
    const config = vscode.workspace.getConfiguration('agents-check');
    const windowMs = config.get<number>('burstDetectionWindowMs', 300);
    const threshold = config.get<number>('burstDetectionThreshold', 8);
    return {
      enabled: config.get<boolean>('burstDetectionEnabled', true),
      windowMs: Number.isFinite(windowMs) ? Math.min(5000, Math.max(50, windowMs)) : 300,
      threshold: Number.isFinite(threshold) ? Math.min(500, Math.max(2, threshold)) : 8,
    };
  }

  notifyExternalBatch(windowMs = 5000): void {
    this.suppressUntil = Date.now() + windowMs;
    this.snapshots.clear();
    if (this.holdResolveTimer) {
      clearTimeout(this.holdResolveTimer);
      this.holdResolveTimer = undefined;
    }
    this.heldWrites.clear();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      void this.watchFolder(folder.uri.fsPath).catch(() => {
      });
    }
  }

  private isSuppressed(): boolean {
    return Date.now() < this.suppressUntil;
  }

  rebuildBaselineAfterRuleChange(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      void this.watchFolder(folder.uri.fsPath);
    }
  }

  private normalizePath(p: string): string {
    const fsPath = vscode.Uri.file(path.resolve(p)).fsPath;
    return process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;
  }

  private normalizeContent(content: string): string {
    return content.trim().replace(/\r\n/g, '\n');
  }

  private watchVscodeEvents(): void {
    const d = vscode.workspace.onDidSaveTextDocument((doc) => {
      const filePath = this.normalizePath(doc.uri.fsPath);
      const text = doc.getText();
      if (exceedsLineLimit(text)) {
        this.snapshots.markSizeSkipped(filePath);
      } else {
        this.snapshots.set(filePath, text);
      }
      this.savedFilesByVsCode.set(filePath, Date.now());
      this.pruneStaleMapEntries();
    });
    this.disposables.push(d);
  }

  private pruneStaleMapEntries(): void {
    const now = Date.now();
    for (const [key, ts] of this.lastProcessed) {
      if (now - ts > WorkspaceWatcher.LAST_PROCESSED_TTL_MS) {
        this.lastProcessed.delete(key);
      }
    }
    for (const [key, ts] of this.savedFilesByVsCode) {
      if (now - ts > WorkspaceWatcher.SAVED_BY_VSCODE_TTL_MS) {
        this.savedFilesByVsCode.delete(key);
      }
    }
  }

  private watchWorkspaceFolders(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    const handleUri = (uri: vscode.Uri) => {
      this.handleExternalWrite(uri);
    };
    
    fileWatcher.onDidChange(handleUri);
    fileWatcher.onDidCreate((uri) => {
      void this.handleExternalCreate(uri);
    });
    fileWatcher.onDidDelete((uri) => {
      this.handleExternalDelete(uri);
    });

    this.disposables.push(fileWatcher);

    for (const folder of folders) {
      void this.watchFolder(folder.uri.fsPath);
    }

    const d = vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const added of e.added) {
        void this.watchFolder(added.uri.fsPath);
      }
    });
    this.disposables.push(d);
  }

  private async watchFolder(folderPath: string): Promise<void> {
    this.baselineScansInProgress++;
    try {
      await this.baselineScanner.buildInitialSnapshots(folderPath);
    } catch (err) {
      console.error('[agents-check] workspaceWatcher buildInitialSnapshots error:', err);
    } finally {
      this.baselineScansInProgress--;
      if (this.baselineScansInProgress === 0) {
        const queued = Array.from(this.queuedExternalWrites.entries());
        this.queuedExternalWrites.clear();
        for (const [filePath, queuedWrite] of queued) {
          this.lastProcessed.delete(filePath);
          this.handleExternalWrite(vscode.Uri.file(filePath), {
            burstHoldOverride: queuedWrite.burstHold,
            readDelayMs: queuedWrite.readDelayMs,
          });
        }
      }
    }
  }

  private async handleExternalCreate(uri: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
      const isSymlink = (stat.type & vscode.FileType.SymbolicLink) !== 0;
      if (!isDirectory) {
        this.handleExternalWrite(uri);
        return;
      }

      const absPath = this.normalizePath(uri.fsPath);
      if (isSymlink || isExcludedPathSegment(absPath) || !this.isInWorkspace(absPath)) {
        return;
      }
      this.scheduleDirectoryScan(uri, absPath);
    } catch {
    }
  }

  private scheduleDirectoryScan(uri: vscode.Uri, absPath: string): void {
    for (const pendingPath of this.pendingDirectoryScans.keys()) {
      if (this.isSameOrDescendant(absPath, pendingPath)) {
        return;
      }
    }

    for (const [pendingPath, timer] of this.pendingDirectoryScans) {
      if (this.isSameOrDescendant(pendingPath, absPath)) {
        clearTimeout(timer);
        this.pendingDirectoryScans.delete(pendingPath);
      }
    }

    const timer = setTimeout(() => {
      this.pendingDirectoryScans.delete(absPath);
      void this.scanCreatedDirectory(uri);
    }, WorkspaceWatcher.DIRECTORY_SETTLE_MS);
    this.pendingDirectoryScans.set(absPath, timer);
  }

  private handleExternalDelete(uri: vscode.Uri): void {
    this.pendingDeletes.add(this.normalizePath(uri.fsPath));
    if (this.deleteSettleTimer) { return; }
    this.deleteSettleTimer = setTimeout(() => {
      this.deleteSettleTimer = undefined;
      void this.flushDeletes();
    }, WorkspaceWatcher.DELETE_SETTLE_MS);
  }

  private async flushDeletes(): Promise<void> {
    const candidates = Array.from(this.pendingDeletes).sort((a, b) => a.length - b.length);
    this.pendingDeletes.clear();
    const gone: string[] = [];
    for (const p of candidates) {
      if (gone.some((root) => this.isSameOrDescendant(p, root))) { continue; }
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(p));
      } catch {
        gone.push(p);
      }
    }
    if (gone.length === 0) { return; }

    const isGone = (p: string): boolean => gone.some((root) => this.isSameOrDescendant(p, root));
    for (const p of this.heldWrites.keys()) {
      if (isGone(p)) { this.heldWrites.delete(p); }
    }
    for (const p of this.queuedExternalWrites.keys()) {
      if (isGone(p)) { this.queuedExternalWrites.delete(p); }
    }
    for (const p of gone) {
      this.snapshots.deleteUnder(p);
    }
    await this.diffManager.forgetDeleted(gone);
  }

  private isSameOrDescendant(candidatePath: string, parentPath: string): boolean {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }

  private async scanCreatedDirectory(rootUri: vscode.Uri): Promise<void> {
    const pending = [rootUri];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(directory);
      } catch {
        continue;
      }

      for (const [name, type] of entries) {
        const childUri = vscode.Uri.joinPath(directory, name);
        const childPath = this.normalizePath(childUri.fsPath);
        if (isExcludedPathSegment(childPath) || (type & vscode.FileType.SymbolicLink) !== 0) {
          continue;
        }
        if ((type & vscode.FileType.Directory) !== 0) {
          pending.push(childUri);
        } else if ((type & vscode.FileType.File) !== 0 && isTextFile(childUri.fsPath)) {
          this.handleExternalWrite(childUri, { readDelayMs: 0 });
        }
      }
    }
  }

  private handleExternalWrite(
    uri: vscode.Uri,
    options: ExternalWriteOptions = {}
  ): void {
    const absPath = this.normalizePath(uri.fsPath);
    const readDelayMs = options.readDelayMs ?? 200;

    const burstHold = options.burstHoldOverride ?? this.burstMeter.record(absPath);

    if (isExcludedPathSegment(absPath)) {
      return;
    }

    const lastVsCodeSave = this.savedFilesByVsCode.get(absPath) ?? 0;
    const now = Date.now();
    if (now - lastVsCodeSave < 2000) {
      return;
    }

    const lastTime = this.lastProcessed.get(absPath) ?? 0;
    if (now - lastTime < 500) { return; }
    this.lastProcessed.set(absPath, now);
    this.pruneStaleMapEntries();

    if (!isTextFile(absPath)) { return; }
    if (!this.isInWorkspace(absPath)) { return; }

    if (this.baselineScansInProgress > 0) {
      this.queuedExternalWrites.set(absPath, { burstHold, readDelayMs });
      return;
    }

    if (readDelayMs <= 0) {
      void this.processExternalWrite(uri, absPath, burstHold);
      return;
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      void this.processExternalWrite(uri, absPath, burstHold);
    }, readDelayMs);
    this.pendingTimers.add(timer);
  }

  private async processExternalWrite(
    uri: vscode.Uri,
    absPath: string,
    burstHold: boolean
  ): Promise<void> {
    const lastVsCodeSaveAfterTimeout = this.savedFilesByVsCode.get(absPath) ?? 0;
    if (Date.now() - lastVsCodeSaveAfterTimeout < 2000) {
      return;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (exceedsSizeLimitByBytes(stat.size)) {
        this.snapshots.markSizeSkipped(absPath);
        return;
      }

      const newContentRaw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (looksBinary(newContentRaw)) { return; }

      if (exceedsLineLimit(newContentRaw)) {
        this.snapshots.markSizeSkipped(absPath);
        return;
      }

      if (this.isSuppressed()) {
        this.snapshots.set(absPath, newContentRaw);
        return;
      }

      const oldContentRaw = this.snapshots.get(absPath);

      const newContent = this.normalizeContent(newContentRaw);
      const oldContent = oldContentRaw !== undefined ? this.normalizeContent(oldContentRaw) : undefined;

      if (oldContent === undefined) {
        this.snapshots.set(absPath, newContentRaw);
        if (this.snapshots.consumeSizeSkipped(absPath)) { return; }
        this.resolveOrHold(absPath, '', newContentRaw, false, burstHold);
        return;
      }

      if (oldContent === newContent) {
        this.snapshots.set(absPath, newContentRaw);
        return;
      }

      this.snapshots.set(absPath, newContentRaw);

      if (!this.diffManager.hasPendingDiff(absPath)) {
        this.resolveOrHold(absPath, oldContentRaw!, newContentRaw, true, burstHold);
      }
    } catch {
    }
  }

  private triggerDiff(
    filePath: string,
    originalContent: string,
    _newContent: string,
    fileExistedBefore: boolean
  ): void {
    this.diffManager.loadSnapshot(filePath, originalContent, fileExistedBefore);
  }

  private resolveOrHold(
    filePath: string,
    originalContent: string,
    newContent: string,
    fileExistedBefore: boolean,
    hold: boolean
  ): void {
    const now = Date.now();
    if (now - this.lastAutoOpenActivityAt > WorkspaceWatcher.ACTIVE_TAB_CAPTURE_GAP_MS) {
      this.diffManager.markActiveTabBeforeAutoOpen();
    }
    this.lastAutoOpenActivityAt = now;

    if (!hold) {
      this.triggerDiff(filePath, originalContent, newContent, fileExistedBefore);
      return;
    }
    this.heldWrites.set(filePath, { originalContent, newContent, fileExistedBefore });
    this.scheduleHoldResolve();
  }

  private scheduleHoldResolve(): void {
    if (this.holdResolveTimer) {
      clearTimeout(this.holdResolveTimer);
    }
    this.holdResolveTimer = setTimeout(() => {
      this.holdResolveTimer = undefined;
      const entries = Array.from(this.heldWrites.entries());
      this.heldWrites.clear();
      for (const [filePath, w] of entries) {
        this.triggerDiff(filePath, w.originalContent, w.newContent, w.fileExistedBefore);
      }
    }, this.holdMs);
  }

  private isInWorkspace(filePath: string): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return false; }
    const normalizedPath = this.normalizePath(filePath);
    return folders.some(f => normalizedPath.startsWith(this.normalizePath(f.uri.fsPath)));
  }

  updateSnapshot(filePath: string, content: string): void {
    this.snapshots.set(this.normalizePath(filePath), content);
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    for (const timer of this.pendingDirectoryScans.values()) {
      clearTimeout(timer);
    }
    this.pendingDirectoryScans.clear();
    if (this.deleteSettleTimer) {
      clearTimeout(this.deleteSettleTimer);
      this.deleteSettleTimer = undefined;
    }
    this.pendingDeletes.clear();
    if (this.holdResolveTimer) {
      clearTimeout(this.holdResolveTimer);
      this.holdResolveTimer = undefined;
    }
    this.heldWrites.clear();
    this.queuedExternalWrites.clear();
  }
}
