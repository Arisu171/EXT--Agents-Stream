import * as path from 'path';
import * as vscode from 'vscode';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { PtySession } from './ptySession';
import { SessionSnapshot } from './terminalTypes';
import {
  getDefaultIdeProfile,
  findIdeProfile,
  resolveSessionCwd,
  ResolvedTerminalProfile,
} from './terminalProfiles';
import { extractCwdFromOutput } from './cwdTracker';
import { buildLaunchWithStartupCommands } from './startupLaunch';

const SCROLLBACK_LINES = 3000;

export interface CreateSessionOptions {
  cols: number;
  rows: number;
  profileId?: string;
  commands?: string[];
  title?: string;
}

interface SessionRecord {
  pty: PtySession;
  subs: vscode.Disposable[];
  title: string;
  cols: number;
  rows: number;
  mirror: HeadlessTerminal;
  serializer: SerializeAddon;
  titleSub: vscode.Disposable;
  rawTitle: string;
  exited: boolean;
  exitCode: number;
  profile: ResolvedTerminalProfile;
  startupCommands: string[];
  cwd: string;
}

export class TerminalSessionStore implements vscode.Disposable {
  private readonly sessions = new Map<string, SessionRecord>();
  private nextSessionNum = 0;
  activeId: string | undefined;

  private readonly _onCreated = new vscode.EventEmitter<{ id: string; title: string }>();
  readonly onCreated = this._onCreated.event;
  private readonly _onClosed = new vscode.EventEmitter<string>();
  readonly onClosed = this._onClosed.event;
  private readonly _onData = new vscode.EventEmitter<{ id: string; data: string }>();
  readonly onData = this._onData.event;
  private readonly _onExit = new vscode.EventEmitter<{ id: string; code: number }>();
  readonly onExit = this._onExit.event;
  private readonly _onError = new vscode.EventEmitter<{ id: string; message: string }>();
  readonly onError = this._onError.event;

  private readonly _onCwd = new vscode.EventEmitter<{ id: string; cwd: string }>();
  readonly onCwd = this._onCwd.event;

  get size(): number {
    return this.sessions.size;
  }

  getActiveCwd(): string | undefined {
    if (!this.activeId) {
      return undefined;
    }
    return this.sessions.get(this.activeId)?.cwd;
  }

  create(options: CreateSessionOptions): string {
    this.nextSessionNum += 1;
    const id = `s${this.nextSessionNum}`;
    const profile = findIdeProfile(options.profileId) ?? getDefaultIdeProfile();
    const title = options.title?.trim() || profile.label || path.basename(profile.path).replace(/\.exe$/i, '');
    const safeCols = Math.max(1, options.cols | 0);
    const safeRows = Math.max(1, options.rows | 0);
    const mirror = new HeadlessTerminal({
      cols: safeCols,
      rows: safeRows,
      scrollback: SCROLLBACK_LINES,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    mirror.loadAddon(serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0]);
    const rec: SessionRecord = {
      pty: new PtySession(),
      subs: [],
      title,
      cols: safeCols,
      rows: safeRows,
      mirror,
      serializer,
      titleSub: { dispose: () => undefined },
      rawTitle: '',
      exited: false,
      exitCode: 0,
      profile,
      startupCommands: (options.commands ?? []).map((c) => c.trim()).filter(Boolean),
      cwd: resolveSessionCwd(profile),
    };
    rec.titleSub = mirror.onTitleChange((next) => { rec.rawTitle = next; });
    this.sessions.set(id, rec);
    this.activeId = id;
    this._onCreated.fire({ id, title });
    this.startPty(id, rec);
    return id;
  }

  close(id: string): void {
    const rec = this.sessions.get(id);
    if (!rec) {
      return;
    }
    this.disposeRecord(rec);
    this.sessions.delete(id);
    if (this.activeId === id) {
      this.activeId = undefined;
    }
    this._onClosed.fire(id);
    if (this.sessions.size === 0) {
      this.create({ cols: 80, rows: 24 });
    }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const rec = this.sessions.get(id);
    if (!rec) {
      return;
    }
    rec.cols = Math.max(1, cols | 0);
    rec.rows = Math.max(1, rows | 0);
    rec.pty.resize(rec.cols, rec.rows);
    try { rec.mirror.resize(rec.cols, rec.rows); } catch {  }
  }

  restart(id: string): void {
    const rec = this.sessions.get(id);
    if (!rec) {
      return;
    }
    for (const d of rec.subs.splice(0)) {
      try { d.dispose(); } catch {  }
    }
    try { rec.pty.dispose(); } catch {  }
    rec.pty = new PtySession();
    rec.exited = false;
    rec.mirror.reset();
    this.startPty(id, rec);
  }

  async snapshot(): Promise<SessionSnapshot[]> {
    const records = Array.from(this.sessions.entries());
    await Promise.all(records.map(([, rec]) => new Promise<void>((resolve) => rec.mirror.write('', resolve))));
    return records
      .filter(([id]) => this.sessions.has(id))
      .map(([id, rec]) => ({
        id,
        title: rec.title,
        rawTitle: rec.rawTitle,
        serialized: rec.serializer.serialize(),
        cols: rec.mirror.cols,
        rows: rec.mirror.rows,
        exited: rec.exited,
        exitCode: rec.exitCode,
      }));
  }

  dispose(): void {
    for (const rec of this.sessions.values()) {
      this.disposeRecord(rec);
    }
    this.sessions.clear();
    this._onCreated.dispose();
    this._onClosed.dispose();
    this._onData.dispose();
    this._onExit.dispose();
    this._onError.dispose();
    this._onCwd.dispose();
  }

  private startPty(id: string, rec: SessionRecord): void {
    const pty = rec.pty;
    const launch = buildLaunchWithStartupCommands(
      rec.profile.path,
      rec.profile.args,
      rec.startupCommands,
    );
    let stdinStartupPending = launch.injectViaStdin && rec.startupCommands.length > 0;
    let stdinStartupTimer: ReturnType<typeof setTimeout> | undefined;
    const flushStdinStartup = (): void => {
      if (!stdinStartupPending) {
        return;
      }
      stdinStartupPending = false;
      if (stdinStartupTimer !== undefined) {
        clearTimeout(stdinStartupTimer);
        stdinStartupTimer = undefined;
      }
      for (const command of rec.startupCommands) {
        pty.write(`${command}\r`);
      }
    };
    const scheduleStdinStartup = (): void => {
      if (!stdinStartupPending) {
        return;
      }
      if (stdinStartupTimer !== undefined) {
        clearTimeout(stdinStartupTimer);
      }
      stdinStartupTimer = setTimeout(flushStdinStartup, 80);
    };
    rec.cwd = resolveSessionCwd(rec.profile);
    rec.subs.push(
      pty.onData((data) => {
        rec.mirror.write(data);
        this._onData.fire({ id, data });
        const nextCwd = extractCwdFromOutput(data, rec.cwd);
        if (nextCwd !== rec.cwd) {
          rec.cwd = nextCwd;
          this._onCwd.fire({ id, cwd: nextCwd });
        }
        scheduleStdinStartup();
      }),
      pty.onExit((code) => {
        if (stdinStartupTimer !== undefined) {
          clearTimeout(stdinStartupTimer);
          stdinStartupTimer = undefined;
        }
        stdinStartupPending = false;
        rec.exited = true;
        rec.exitCode = code;
        this._onExit.fire({ id, code });
      }),
      pty.onError((message) => {
        if (stdinStartupTimer !== undefined) {
          clearTimeout(stdinStartupTimer);
          stdinStartupTimer = undefined;
        }
        stdinStartupPending = false;
        rec.exited = true;
        rec.exitCode = -1;
        this._onError.fire({ id, message });
      }),
      { dispose: () => {
        if (stdinStartupTimer !== undefined) {
          clearTimeout(stdinStartupTimer);
          stdinStartupTimer = undefined;
        }
      } },
    );
    pty.start(rec.cols, rec.rows, {
      shellPath: launch.shellPath,
      args: launch.args,
      env: rec.profile.env,
      cwd: resolveSessionCwd(rec.profile),
    });
  }

  private disposeRecord(rec: SessionRecord): void {
    for (const d of rec.subs) {
      try { d.dispose(); } catch {  }
    }
    try { rec.pty.dispose(); } catch {  }
    try { rec.titleSub.dispose(); } catch {  }
    try { rec.mirror.dispose(); } catch {  }
  }
}
