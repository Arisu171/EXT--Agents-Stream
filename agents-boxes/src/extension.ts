/**
 * agents-boxes: embedded terminal / chat for Agents Stream.
 * Copyright (c) 2026 orias <alongworkez@gmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as vscode from 'vscode';
import { applyAltMenuFocus } from './boxes/altMenuFocus';
import { ChatTerminalPanel, type CheckApi } from './boxes/chatTerminalPanel';
import { TerminalSessionStore } from './boxes/terminalSessions';

const LOG_PREFIX = '[agents-boxes]';

export async function activate(
  context: vscode.ExtensionContext,
  checkApi?: CheckApi,
): Promise<void> {
  const channel = vscode.window.createOutputChannel('Agents Boxes');
  context.subscriptions.push(channel);
  channel.appendLine(`${LOG_PREFIX} activate`);

  void applyAltMenuFocus(context).catch((err: unknown) => {
    channel.appendLine(`${LOG_PREFIX} altMenuFocus failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const sessions = new TerminalSessionStore();
  const panel = new ChatTerminalPanel(context, sessions, checkApi);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatTerminalPanel.viewType,
      panel,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    { dispose: () => panel.dispose() },
    sessions,
    vscode.commands.registerCommand('agents-boxes.focusTerminal', () => panel.focusTerminal()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agents-boxes.preventAltMenuFocus')) {
        void applyAltMenuFocus(context).catch((err: unknown) => {
          channel.appendLine(
            `${LOG_PREFIX} altMenuFocus failed: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      }
    }),
  );

  const movedKey = 'agents-boxes.movedToRight';
  if (!context.globalState.get<boolean>(movedKey)) {
    void context.globalState.update(movedKey, true);
    setTimeout(() => {
      void (async () => {
        try {
          await vscode.commands.executeCommand('agents-boxes.terminal.focus');
          await vscode.commands.executeCommand('workbench.action.moveView', {
            viewId: ChatTerminalPanel.viewType,
            destinationId: 'workbench.view.auxiliarybar',
          });
        } catch {
        }
      })();
    }, 1500);
  }

  channel.appendLine(`${LOG_PREFIX} activate:complete`);
}

export function deactivate(): void {
}
