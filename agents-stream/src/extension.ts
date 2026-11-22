/**
 * Agents Stream: unified shell that activates Check then Boxes.
 * Copyright (c) 2026 orias <alongworkez@gmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as vscode from 'vscode';

interface CheckExports {
  activate(context: vscode.ExtensionContext): Promise<unknown>;
  deactivate?(): void;
}

interface BoxesExports {
  activate(context: vscode.ExtensionContext, checkApi?: unknown): Promise<void>;
  deactivate?(): void;
}

let checkMod: CheckExports | undefined;
let boxesMod: BoxesExports | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
  checkMod = require('./check/extension') as CheckExports;
  boxesMod = require('./boxes/extension') as BoxesExports;

  const checkApi = await checkMod.activate(context);
  await boxesMod.activate(context, checkApi);
  return checkApi;
}

export function deactivate(): void {
  try {
    boxesMod?.deactivate?.();
  } catch {
  }
  try {
    checkMod?.deactivate?.();
  } catch {
  }
}
