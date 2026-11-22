import * as vscode from 'vscode';

const OVERRIDDEN_KEY = 'agents-boxes.altMenuFocusOverridden';

export async function applyAltMenuFocus(context: vscode.ExtensionContext): Promise<void> {
  const prevent = vscode.workspace
    .getConfiguration('agents-boxes')
    .get<boolean>('preventAltMenuFocus', true);
  const windowConfig = vscode.workspace.getConfiguration('window');
  const current = windowConfig.inspect<boolean>('customMenuBarAltFocus')?.globalValue;

  if (prevent) {
    if (current === false) {
      return;
    }
    await windowConfig.update('customMenuBarAltFocus', false, vscode.ConfigurationTarget.Global);
    await context.globalState.update(OVERRIDDEN_KEY, true);
    return;
  }

  if (!context.globalState.get<boolean>(OVERRIDDEN_KEY)) {
    return;
  }
  if (current === false) {
    await windowConfig.update('customMenuBarAltFocus', undefined, vscode.ConfigurationTarget.Global);
  }
  await context.globalState.update(OVERRIDDEN_KEY, false);
}
