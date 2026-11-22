
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffManager } from '../check/diffManager';
import { WorkspaceWatcher } from './workspaceWatcher';
import { notify } from '../utils/notify';

const STORED_HEAD_KEY = 'agents-check.lastHeadByFolder';

const REFLOG_CONFIRM_ACTION = /^(pull|merge|rebase|reset)\b/i;

export class GitBranchWatcher {
  private disposables: vscode.Disposable[] = [];
  private fsWatchers: Map<string, fs.FSWatcher> = new Map();
  private headContents: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private reflogWatchers: Map<string, fs.FSWatcher> = new Map();
  private reflogDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly diffManager: DiffManager,
    private readonly workspaceState: vscode.Memento,
    private readonly workspaceWatcher: WorkspaceWatcher,
    private readonly debounceMs: number = 1000,
  ) {}

  private getStoredHead(folderPath: string): string | undefined {
    const map = this.workspaceState.get<Record<string, string>>(STORED_HEAD_KEY, {});
    return map[folderPath];
  }

  private async setStoredHead(folderPath: string, head: string): Promise<void> {
    const map = this.workspaceState.get<Record<string, string>>(STORED_HEAD_KEY, {});
    map[folderPath] = head;
    await this.workspaceState.update(STORED_HEAD_KEY, map);
  }

  start(): void {
    this.watchAllRoots();

    const d = vscode.workspace.onDidChangeWorkspaceFolders(e => {
      for (const removed of e.removed) {
        this.unwatchRoot(removed.uri.fsPath);
      }
      this.watchAllRoots();
    });
    this.disposables.push(d);
  }

  private watchAllRoots(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }

    for (const folder of folders) {
      this.watchRoot(folder.uri.fsPath);
    }
  }

  private watchRoot(folderPath: string): void {
    if (this.fsWatchers.has(folderPath)) { return; }

    const gitHead = resolveGitHeadPath(folderPath);
    if (!gitHead) { return; }

    let initialHead: string;
    try {
      initialHead = fs.readFileSync(gitHead, 'utf8').trim();
    } catch {
      return;
    }
    this.headContents.set(folderPath, initialHead);

    const storedHead = this.getStoredHead(folderPath);
    if (storedHead !== undefined && storedHead !== initialHead) {
      this.workspaceWatcher.notifyExternalBatch();
      void this.clearPendingDiffs();
    }
    void this.setStoredHead(folderPath, initialHead);

    const watcher = fs.watch(path.dirname(gitHead), () => {
      this.onHeadChange(folderPath, gitHead);
    });

    watcher.on('error', () => {
    });

    this.fsWatchers.set(folderPath, watcher);

    const reflogPath = path.join(path.dirname(gitHead), 'logs', 'HEAD');
    if (fs.existsSync(reflogPath)) {
      const reflogWatcher = fs.watch(path.dirname(reflogPath), () => {
        this.onReflogChange(folderPath, reflogPath);
      });
      reflogWatcher.on('error', () => {
      });
      this.reflogWatchers.set(folderPath, reflogWatcher);
    }
  }

  private unwatchRoot(folderPath: string): void {
    const watcher = this.fsWatchers.get(folderPath);
    if (watcher) {
      try { watcher.close(); } catch {  }
      this.fsWatchers.delete(folderPath);
    }

    const timer = this.debounceTimers.get(folderPath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(folderPath);
    }

    this.headContents.delete(folderPath);

    const reflogWatcher = this.reflogWatchers.get(folderPath);
    if (reflogWatcher) {
      try { reflogWatcher.close(); } catch {  }
      this.reflogWatchers.delete(folderPath);
    }

    const reflogTimer = this.reflogDebounceTimers.get(folderPath);
    if (reflogTimer) {
      clearTimeout(reflogTimer);
      this.reflogDebounceTimers.delete(folderPath);
    }
  }

  private onHeadChange(folderPath: string, gitHead: string): void {
    const existing = this.debounceTimers.get(folderPath);
    if (existing) { clearTimeout(existing); }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(folderPath);

      let newContent: string;
      try {
        newContent = fs.readFileSync(gitHead, 'utf8').trim();
      } catch {
        return;
      }

      const oldContent = this.headContents.get(folderPath);
      if (oldContent !== undefined && oldContent !== newContent) {
        this.headContents.set(folderPath, newContent);
        void this.setStoredHead(folderPath, newContent);
        this.workspaceWatcher.notifyExternalBatch();
        this.clearPendingDiffs();
      }
    }, this.debounceMs);

    this.debounceTimers.set(folderPath, timer);
  }

  private onReflogChange(folderPath: string, reflogPath: string): void {
    const existing = this.reflogDebounceTimers.get(folderPath);
    if (existing) { clearTimeout(existing); }

    const timer = setTimeout(() => {
      this.reflogDebounceTimers.delete(folderPath);

      let content: string;
      try {
        content = fs.readFileSync(reflogPath, 'utf8');
      } catch {
        return;
      }

      const lines = content.split('\n').filter(line => line.trim().length > 0);
      const lastLine = lines[lines.length - 1];
      if (!lastLine) { return; }

      const tabIndex = lastLine.indexOf('\t');
      const message = tabIndex >= 0 ? lastLine.slice(tabIndex + 1).trim() : '';
      if (!REFLOG_CONFIRM_ACTION.test(message)) { return; }

      this.workspaceWatcher.notifyExternalBatch();
    }, this.debounceMs);

    this.reflogDebounceTimers.set(folderPath, timer);
  }

  private async clearPendingDiffs(): Promise<void> {
    const count = this.diffManager.getPendingFiles().length;
    if (count === 0) { return; }

    await this.diffManager.clearAll();
    notify(`Git branch changed : cleared ${count} pending diff${count > 1 ? 's' : ''}.`);
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) { clearTimeout(timer); }
    this.debounceTimers.clear();

    for (const watcher of this.fsWatchers.values()) { watcher.close(); }
    this.fsWatchers.clear();

    for (const timer of this.reflogDebounceTimers.values()) { clearTimeout(timer); }
    this.reflogDebounceTimers.clear();

    for (const watcher of this.reflogWatchers.values()) { watcher.close(); }
    this.reflogWatchers.clear();

    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }
}

function resolveGitHeadPath(folderPath: string): string | undefined {
  const dotGit = path.join(folderPath, '.git');

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return undefined;
  }

  if (stat.isDirectory()) {
    const head = path.join(dotGit, 'HEAD');
    return fs.existsSync(head) ? head : undefined;
  }

  if (stat.isFile()) {
    let content: string;
    try {
      content = fs.readFileSync(dotGit, 'utf8');
    } catch {
      return undefined;
    }

    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) { return undefined; }

    const gitdirRaw = match[1].trim();
    const gitdir = path.isAbsolute(gitdirRaw)
      ? gitdirRaw
      : path.resolve(folderPath, gitdirRaw);

    const head = path.join(gitdir, 'HEAD');
    return fs.existsSync(head) ? head : undefined;
  }

  return undefined;
}
