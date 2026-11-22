import * as vscode from 'vscode';

const AUTO_CLOSE_MS = 2000;

export function notify(message: string, ms = AUTO_CLOSE_MS): void {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: message, cancellable: false },
    () => new Promise<void>((resolve) => setTimeout(resolve, ms))
  );
}
