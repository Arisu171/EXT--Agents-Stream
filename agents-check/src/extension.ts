/**
 * agents-check: diff review for Agents Stream.
 * Copyright (c) 2026 orias <alongworkez@gmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as vscode from 'vscode';
import { DiffManager } from './check/diffManager';
import { DiffEditorProvider, DIFF_EDITOR_VIEW_TYPE } from './check/diffWebviewPanel';
import { IAiRunner } from './runner/aiRunner';
import { WorkspaceWatcher } from './watcher/workspaceWatcher';
import { migrateLegacyTextFileSettings, refreshTextFileRules } from './watcher/fileTypeRules';
import { refreshFileSizeLimit } from './watcher/fileSizeLimit';
import { clearGitignoreCache, isExcludedPathSegment, refreshPathExclusions } from './watcher/pathExclusions';
import { GitBranchWatcher } from './watcher/gitBranchWatcher';
import { registerAllCommands } from './cmds/commandsRegistry';
import { NavigationManager } from './check/navigationManager';
import { PendingFilesPanel } from './views/pendingFilesPanel';
import { coalesce } from './utils/coalesce';

const LOG_PREFIX = '[agents-check]';

let diagnosticChannel: vscode.OutputChannel | undefined;

function debugLog(message: string): void {
  const line = `${LOG_PREFIX} ${new Date().toISOString()} ${message}`;
  console.log(line);
  diagnosticChannel?.appendLine(line);
}

function debugError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error ?? '');
  const line = `${LOG_PREFIX} ${new Date().toISOString()} ${message} ${detail}`;
  console.error(line, error ?? '');
  diagnosticChannel?.appendLine(line);
}

export interface AgentsCheckApi {
  getPendingSummaries(underRoot?: string): Promise<Array<{
    path: string;
    name: string;
    relativePath: string;
    additions: number;
    deletions: number;
  }>>;
  acceptFile(filePath: string): Promise<void>;
  acceptAllPending(underRoot?: string): Promise<number>;
  openPendingFile(filePath: string): Promise<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<AgentsCheckApi> {
  diagnosticChannel = vscode.window.createOutputChannel('Agents Check');
  context.subscriptions.push(diagnosticChannel);

  try {
    return await activateExtension(context);
  } catch (error: unknown) {
    debugError('activate:failed', error);
    void vscode.window.showErrorMessage(
      `Agents Check failed to activate: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

async function activateExtension(context: vscode.ExtensionContext): Promise<AgentsCheckApi> {
  debugLog(`activate:start mode=${context.extensionMode}`);

  await migrateLegacyTextFileSettings();
  refreshTextFileRules();
  refreshFileSizeLimit();
  refreshPathExclusions();

  const diffManager = new DiffManager(context);
  const workspaceWatcher = new WorkspaceWatcher(diffManager);
  const gitBranchWatcher = new GitBranchWatcher(diffManager, context.workspaceState, workspaceWatcher);
  const navigationManager = new NavigationManager(diffManager);
  context.subscriptions.push({ dispose: () => diffManager.flushPendingSave() });

  const diffEditorProvider = new DiffEditorProvider(context.extensionUri, diffManager);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DIFF_EDITOR_VIEW_TYPE,
      diffEditorProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  const pendingFilesPanel = new PendingFilesPanel(context.extensionUri, diffManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PendingFilesPanel.viewType,
      pendingFilesPanel,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    { dispose: () => pendingFilesPanel.dispose() },
    diffManager.onDidChangeDiffs(() => pendingFilesPanel.scheduleRefresh())
  );

  let activeRunner: IAiRunner | undefined;

  context.subscriptions.push(
    { dispose: () => diffManager.disposeAll() },
    { dispose: () => workspaceWatcher.dispose() },
    { dispose: () => gitBranchWatcher.dispose() },
    { dispose: () => activeRunner?.cancel?.() }
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agents-check.supportedFileDetectionMode') ||
          e.affectsConfiguration('agents-check.includedPaths') ||
          e.affectsConfiguration('agents-check.supportedFileExtensions') ||
          e.affectsConfiguration('agents-check.supportedFilenames') ||
          e.affectsConfiguration('agents-check.supportedFilenamePatterns')) {
        refreshTextFileRules();
        workspaceWatcher.rebuildBaselineAfterRuleChange();
      }
      if (e.affectsConfiguration('agents-check.maxFileLines')) {
        refreshFileSizeLimit();
      }
      if (e.affectsConfiguration('agents-check.excludedPaths') ||
          e.affectsConfiguration('agents-check.respectGitignore')) {
        refreshPathExclusions();
        workspaceWatcher.rebuildBaselineAfterRuleChange();
      }
    })
  );

  const gitignoreChangedSoon = coalesce(() => {
    clearGitignoreCache();
    workspaceWatcher.rebuildBaselineAfterRuleChange();
  });
  const gitignoreWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
  const onGitignoreChange = (uri: vscode.Uri): void => {
    if (!isExcludedPathSegment(uri.fsPath)) { gitignoreChangedSoon.schedule(); }
  };
  context.subscriptions.push(
    gitignoreWatcher,
    gitignoreWatcher.onDidCreate(onGitignoreChange),
    gitignoreWatcher.onDidChange(onGitignoreChange),
    gitignoreWatcher.onDidDelete(onGitignoreChange),
    { dispose: () => gitignoreChangedSoon.dispose() },
  );

  workspaceWatcher.start();
  gitBranchWatcher.start();

  registerAllCommands({
    diffManager,
    context,
    getRunner: () => activeRunner,
    setRunner: (r) => { activeRunner = r; },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('agents-check.nextFile', () => navigationManager.nextFile()),
    vscode.commands.registerCommand('agents-check.prevFile', () => navigationManager.prevFile()),
  );

  function updatePendingContext(): void {
    const has = diffManager.getPendingCount() > 0;
    void vscode.commands.executeCommand('setContext', 'agents-check.hasPendingDiff', has);
  }

  const pendingContextSoon = coalesce(updatePendingContext, 150, 800);
  context.subscriptions.push(
    { dispose: () => pendingContextSoon.dispose() },
    diffManager.onDidChangeDiffs(() => pendingContextSoon.schedule()),
    vscode.window.tabGroups.onDidChangeTabs(() => pendingContextSoon.schedule())
  );

  const autoRouting = new Set<string>();

  const autoRouteTab = (tab: vscode.Tab): void => {
    if (!(tab.input instanceof vscode.TabInputText)) { return; }
    if (tab.isDirty) { return; }
    const fsPath = tab.input.uri.fsPath;
    if (!diffManager.hasPendingDiff(fsPath)) { return; }
    if (autoRouting.has(fsPath)) { return; }
    autoRouting.add(fsPath);
    void (async () => {
      try {
        await vscode.window.tabGroups.close(tab);
        await diffManager.openDiff(fsPath);
      } catch (err) {
        console.error('[agents-check] auto-route failed:', err);
      } finally {
        autoRouting.delete(fsPath);
      }
    })();
  };

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.opened) { autoRouteTab(tab); }
    })
  );

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) { autoRouteTab(tab); }
  }

  updatePendingContext();
  debugLog('activate:complete (diff-only)');

  const api: AgentsCheckApi = {
    getPendingSummaries: (underRoot?: string) => diffManager.getPendingSummaries(underRoot),
    acceptFile: async (filePath: string) => { await diffManager.accept(filePath); },
    acceptAllPending: (underRoot?: string) => diffManager.acceptAllPending(underRoot),
    openPendingFile: async (filePath: string) => { await diffManager.openDiff(filePath); },
  };
  return api;
}

export function deactivate(): void {
}
