import * as os from 'os';
import * as vscode from 'vscode';
import { getFreshEnv } from './freshEnv';

type IPtyModule = typeof import('node-pty');
type IPty = ReturnType<IPtyModule['spawn']>;

export interface PtySpawnOptions {
  shellPath: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class PtySession {
  private proc: IPty | undefined;

  private readonly _onData = new vscode.EventEmitter<string>();
  readonly onData = this._onData.event;

  private readonly _onExit = new vscode.EventEmitter<number>();
  readonly onExit = this._onExit.event;

  private readonly _onError = new vscode.EventEmitter<string>();
  readonly onError = this._onError.event;

  isRunning(): boolean {
    return this.proc !== undefined;
  }

  start(cols: number, rows: number, options: PtySpawnOptions): void {
    if (this.proc) {
      return;
    }
    let ptyMod: IPtyModule;
    try {
      ptyMod = require('node-pty') as IPtyModule;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onError.fire(`node-pty failed to load: ${msg}`);
      return;
    }

    const shell = options.shellPath;
    const args = options.args ?? [];
    const cwd = options.cwd || os.homedir();
    const env = {
      ...getFreshEnv(),
      ...(options.env ?? {}),
    };

    try {
      this.proc = ptyMod.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(1, cols),
        rows: Math.max(1, rows),
        cwd,
        env,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onError.fire(`failed to spawn ${shell}: ${msg}`);
      return;
    }

    this.proc.onData((d) => this._onData.fire(d));
    this.proc.onExit(({ exitCode }) => {
      this._onExit.fire(exitCode);
      this.proc = undefined;
    });
  }

  write(data: string): void {
    this.proc?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.proc) {
      return;
    }
    try {
      this.proc.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
    }
  }

  dispose(): void {
    try {
      this.proc?.kill();
    } catch {
    }
    this.proc = undefined;
    this._onData.dispose();
    this._onExit.dispose();
    this._onError.dispose();
  }
}
