import * as path from 'path';
import * as vscode from 'vscode';
import { buildChatTerminalHtml } from './chatTerminalHtml';
import { TerminalSessionStore } from './terminalSessions';
import { listIdeTerminalProfiles } from './terminalProfiles';
import { isAbsoluteFsPath } from './cwdTracker';
import {
  deleteLaunchTemplate,
  findLaunchTemplate,
  loadLaunchTemplates,
  upsertLaunchTemplate,
} from './launchTemplates';
import {
  BurstDetectionSettings,
  DEFAULT_BURST_DETECTION_SETTINGS,
  DEFAULT_FILE_LIMIT_SETTINGS,
  DEFAULT_FOCUS_SETTINGS,
  DEFAULT_SETTINGS,
  FileLimitSettings,
  FocusSettings,
  IncomingMessage,
  MAX_FILE_LINES_CEILING,
  TerminalSettings,
  TerminalSettingsPayload,
  ThemePreset,
} from './terminalTypes';
import { THEME_PRESET_IDS } from './terminalThemes';

const SETTINGS_KEY = 'agents-boxes.terminal.settings';
const CHECK_EXTENSION_ID = 'orias.agents-check';

export type PendingSummary = {
  path: string;
  name: string;
  relativePath: string;
  additions: number;
  deletions: number;
};

export interface CheckApi {
  getPendingSummaries(underRoot?: string): Promise<PendingSummary[]>;
  acceptFile(filePath: string): Promise<void>;
  acceptAllPending(underRoot?: string): Promise<number>;
  openPendingFile(filePath: string): Promise<void>;
}

export class ChatTerminalPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agents-boxes.terminal';

  private view?: vscode.WebviewView;
  private webview?: vscode.Webview;
  private messageSub?: vscode.Disposable;
  private disposeSub?: vscode.Disposable;
  private readonly sessionSubs: vscode.Disposable[] = [];
  private restoreQueue: unknown[] | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: TerminalSessionStore,
    private readonly injectedCheckApi?: CheckApi,
  ) {
    this.sessionSubs.push(
      sessions.onCreated(({ id, title }) => this.postSession({ type: 'sessionCreated', id, title })),
      sessions.onClosed((id) => this.postSession({ type: 'sessionClosed', id })),
      sessions.onData(({ id, data }) => this.postSession({ type: 'data', id, data })),
      sessions.onExit(({ id, code }) => this.postSession({ type: 'exit', id, code })),
      sessions.onError(({ id, message }) => this.postSession({ type: 'error', id, message })),
      sessions.onCwd(({ id }) => {
        if (id === this.sessions.activeId) {
          void this.postPendingSummaries();
        }
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.attach(webviewView.webview);
    this.disposeSub?.dispose();
    this.disposeSub = webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.detach();
      }
    });
  }

  focusTerminal(): void {
    try {
      this.view?.show(false);
      void this.webview?.postMessage({ type: 'focusTerminal' });
    } catch {
    }
  }

  dispose(): void {
    for (const d of this.sessionSubs) {
      d.dispose();
    }
    this.detach();
  }

  private detach(): void {
    this.messageSub?.dispose();
    this.messageSub = undefined;
    this.disposeSub?.dispose();
    this.disposeSub = undefined;
    this.webview = undefined;
    this.view = undefined;
    this.restoreQueue = undefined;
  }

  private attach(webview: vscode.Webview): void {
    this.webview = webview;
    const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'assets');
    webview.options = {
      enableScripts: true,
      localResourceRoots: [assetsRoot],
    };
    this.messageSub?.dispose();
    this.messageSub = webview.onDidReceiveMessage((msg: IncomingMessage) => {
      void this.onMessage(msg);
    });
    webview.html = buildChatTerminalHtml({
      webview,
      extensionUri: this.context.extensionUri,
    });
  }

  private async onMessage(msg: IncomingMessage): Promise<void> {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    switch (msg.type) {
      case 'ready':
        await this.restoreSessions();
        this.postDiffExtensionState();
        await this.postPendingSummaries();
        return;
      case 'createSession': {
        const template = findLaunchTemplate(this.context, msg.templateId);
        this.sessions.create({
          cols: msg.cols,
          rows: msg.rows,
          profileId: template?.profileId ?? msg.profileId,
          commands: template?.commands,
          title: template?.name,
        });
        return;
      }
      case 'requestLaunchMenu':
        this.postLaunchMenu();
        return;
      case 'closeSession':
        this.sessions.close(msg.id);
        return;
      case 'input':
        this.sessions.write(msg.id, msg.data);
        return;
      case 'resize':
        this.sessions.resize(msg.id, msg.cols, msg.rows);
        return;
      case 'activeSession':
        this.sessions.activeId = msg.id;
        await this.postPendingSummaries();
        return;
      case 'restart':
        this.sessions.restart(msg.id);
        return;
      case 'getSettings':
        this.post({
          type: 'settings',
          settings: this.loadSettingsPayload(),
          templates: loadLaunchTemplates(this.context),
        });
        return;
      case 'updateSettings':
        await this.saveAdvanced(msg.settings);
        this.post({
          type: 'settings',
          settings: this.loadSettingsPayload(),
          templates: loadLaunchTemplates(this.context),
        });
        return;
      case 'upsertTemplate':
        try {
          await upsertLaunchTemplate(this.context, msg.template);
          this.postLaunchMenu();
        } catch (err: unknown) {
          void vscode.window.showErrorMessage(
            `Could not save template: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        return;
      case 'deleteTemplate':
        await deleteLaunchTemplate(this.context, msg.id);
        this.postLaunchMenu();
        return;
      case 'acceptAllChanges': {
        const api = await this.resolveCheckApi();
        if (!api) {
          void vscode.window.showInformationMessage(
            'Install “Agents Check” to accept pending diffs from this footer.'
          );
          return;
        }
        const cwd = this.sessions.getActiveCwd();
        await api.acceptAllPending(cwd && isAbsoluteFsPath(cwd) ? cwd : undefined);
        await this.postPendingSummaries();
        return;
      }
      case 'requestPendingSummaries':
        await this.postPendingSummaries();
        return;
      case 'acceptPendingFile': {
        const api = await this.resolveCheckApi();
        if (!api) {
          void vscode.window.showInformationMessage(
            'Install “Agents Check” to accept pending diffs from this footer.'
          );
          return;
        }
        await api.acceptFile(msg.path);
        await this.postPendingSummaries();
        return;
      }
      case 'openPendingFile': {
        const api = await this.resolveCheckApi();
        if (!api) {
          void vscode.window.showInformationMessage(
            'Install “Agents Check” to open pending diffs from this footer.'
          );
          return;
        }
        await api.openPendingFile(msg.path);
        return;
      }
      default:
        return;
    }
  }

  private async postPendingSummaries(): Promise<void> {
    const api = await this.resolveCheckApi();
    if (!api) {
      this.post({ type: 'pendingSummaries', available: false, files: [] });
      return;
    }
    const underRoot = this.sessions.getActiveCwd();
    try {
      const all = await api.getPendingSummaries();
      const list = Array.isArray(all) ? all : [];
      const files = filterPendingUnderRoot(list, underRoot);
      this.post({
        type: 'pendingSummaries',
        available: true,
        files,
        cwd: underRoot,
      });
    } catch (err: unknown) {
      console.error('[agents-boxes] getPendingSummaries failed:', err);
      this.post({ type: 'pendingSummaries', available: false, files: [] });
    }
  }

  private postDiffExtensionState(): void {
    void this.resolveCheckApi().then((api) => {
      this.post({ type: 'diffExtensionState', available: !!api });
    });
  }

  private async resolveCheckApi(): Promise<CheckApi | undefined> {
    if (this.injectedCheckApi && typeof this.injectedCheckApi.getPendingSummaries === 'function') {
      return this.injectedCheckApi;
    }
    const ext = vscode.extensions.getExtension(CHECK_EXTENSION_ID);
    if (!ext) {
      return undefined;
    }
    try {
      const exports = ext.isActive ? ext.exports : await ext.activate();
      if (!exports || typeof exports.getPendingSummaries !== 'function') {
        return undefined;
      }
      return exports as CheckApi;
    } catch (err: unknown) {
      console.error('[agents-boxes] activate Agents Check failed:', err);
      return undefined;
    }
  }

  private postLaunchMenu(): void {
    const profiles = listIdeTerminalProfiles().map((p) => ({
      id: p.id,
      label: p.label,
      isDefault: p.isDefault,
    }));
    this.post({
      type: 'launchMenu',
      profiles,
      templates: loadLaunchTemplates(this.context),
    });
  }

  private postSession(msg: unknown): void {
    if (this.restoreQueue) {
      this.restoreQueue.push(msg);
      return;
    }
    this.post(msg);
  }

  private post(msg: unknown): void {
    try {
      void this.webview?.postMessage(msg);
    } catch {
    }
  }

  private async restoreSessions(): Promise<void> {
    if (this.sessions.size === 0) {
      this.sessions.create({ cols: 80, rows: 24 });
      return;
    }
    this.restoreQueue = [];
    try {
      const sessions = await this.sessions.snapshot();
      this.post({ type: 'restoreSessions', sessions, activeId: this.sessions.activeId });
    } finally {
      const queued = this.restoreQueue ?? [];
      this.restoreQueue = undefined;
      for (const msg of queued) {
        this.post(msg);
      }
    }
  }

  private loadSettings(): TerminalSettings {
    const stored = this.context.globalState.get<Partial<TerminalSettings>>(SETTINGS_KEY);
    if (!stored || typeof stored !== 'object') {
      return { ...DEFAULT_SETTINGS, customColors: { ...DEFAULT_SETTINGS.customColors } };
    }
    const presets: string[] = ['vscode', 'custom', ...THEME_PRESET_IDS];
    let themePreset = presets.includes(stored.themePreset as string)
      ? (stored.themePreset as ThemePreset)
      : DEFAULT_SETTINGS.themePreset;
    if (themePreset === 'ubuntu') {
      themePreset = 'vscode';
    }
    const fontFamilyRaw =
      typeof stored.fontFamily === 'string' && stored.fontFamily.trim()
        ? stored.fontFamily
        : DEFAULT_SETTINGS.fontFamily;
    const migratedFromUbuntu =
      stored.themePreset === 'ubuntu' || /ubuntu mono/i.test(fontFamilyRaw);
    const settings: TerminalSettings = {
      fontFamily: /ubuntu mono/i.test(fontFamilyRaw) ? DEFAULT_SETTINGS.fontFamily : fontFamilyRaw,
      fontSize: typeof stored.fontSize === 'number' ? stored.fontSize : DEFAULT_SETTINGS.fontSize,
      themePreset,
      customColors: {
        background:
          migratedFromUbuntu
            ? DEFAULT_SETTINGS.customColors.background
            : (stored.customColors?.background ?? DEFAULT_SETTINGS.customColors.background),
        foreground:
          migratedFromUbuntu
            ? DEFAULT_SETTINGS.customColors.foreground
            : (stored.customColors?.foreground ?? DEFAULT_SETTINGS.customColors.foreground),
        cursor:
          migratedFromUbuntu
            ? DEFAULT_SETTINGS.customColors.cursor
            : (stored.customColors?.cursor ?? DEFAULT_SETTINGS.customColors.cursor),
      },
      cursorStyle: stored.cursorStyle ?? DEFAULT_SETTINGS.cursorStyle,
      cursorBlink: typeof stored.cursorBlink === 'boolean' ? stored.cursorBlink : DEFAULT_SETTINGS.cursorBlink,
    };
    if (migratedFromUbuntu) {
      void this.context.globalState.update(SETTINGS_KEY, settings);
    }
    return settings;
  }

  private loadSettingsPayload(): TerminalSettingsPayload {
    const config = vscode.workspace.getConfiguration('agents-check');
    const chatConfig = vscode.workspace.getConfiguration('agents-boxes');
    const burst: BurstDetectionSettings = {
      burstDetectionEnabled: config.get('burstDetectionEnabled', DEFAULT_BURST_DETECTION_SETTINGS.burstDetectionEnabled),
      burstDetectionWindowMs: config.get('burstDetectionWindowMs', DEFAULT_BURST_DETECTION_SETTINGS.burstDetectionWindowMs),
      burstDetectionThreshold: config.get('burstDetectionThreshold', DEFAULT_BURST_DETECTION_SETTINGS.burstDetectionThreshold),
      burstDetectionHoldMs: config.get('burstDetectionHoldMs', DEFAULT_BURST_DETECTION_SETTINGS.burstDetectionHoldMs),
    };
    const limits: FileLimitSettings = {
      maxFileLines: config.get('maxFileLines', DEFAULT_FILE_LIMIT_SETTINGS.maxFileLines),
    };
    const focus: FocusSettings = {
      preventAltMenuFocus: chatConfig.get('preventAltMenuFocus', DEFAULT_FOCUS_SETTINGS.preventAltMenuFocus),
    };
    return { ...this.loadSettings(), ...burst, ...limits, ...focus };
  }

  private async saveAdvanced(incoming: TerminalSettingsPayload): Promise<void> {
    const config = vscode.workspace.getConfiguration('agents-check');
    const chatConfig = vscode.workspace.getConfiguration('agents-boxes');
    await Promise.all([
      this.context.globalState.update(SETTINGS_KEY, this.loadSettings()),
      config.update('burstDetectionEnabled', !!incoming.burstDetectionEnabled, vscode.ConfigurationTarget.Global),
      config.update(
        'burstDetectionWindowMs',
        Math.min(5000, Math.max(50, Number(incoming.burstDetectionWindowMs) || 300)),
        vscode.ConfigurationTarget.Global
      ),
      config.update(
        'burstDetectionThreshold',
        Math.min(500, Math.max(2, Number(incoming.burstDetectionThreshold) || 8)),
        vscode.ConfigurationTarget.Global
      ),
      config.update(
        'burstDetectionHoldMs',
        Math.min(10000, Math.max(500, Number(incoming.burstDetectionHoldMs) || 2000)),
        vscode.ConfigurationTarget.Global
      ),
      config.update(
        'maxFileLines',
        Math.min(MAX_FILE_LINES_CEILING, Math.max(0, Math.floor(Number(incoming.maxFileLines) || 0))),
        vscode.ConfigurationTarget.Global
      ),
      chatConfig.update('preventAltMenuFocus', !!incoming.preventAltMenuFocus, vscode.ConfigurationTarget.Global),
    ]);
  }
}

function normalizeRoot(root: string): string {
  const fsPath = vscode.Uri.file(root).fsPath.replace(/[/\\]+$/, '');
  return process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;
}

function isUnderRoot(filePath: string, rootNorm: string): boolean {
  const fileNorm = process.platform === 'win32'
    ? vscode.Uri.file(filePath).fsPath.toLowerCase()
    : vscode.Uri.file(filePath).fsPath;
  return fileNorm === rootNorm
    || fileNorm.startsWith(rootNorm + path.sep)
    || fileNorm.startsWith(rootNorm + '/');
}

function filterPendingUnderRoot(files: PendingSummary[], underRoot: string | undefined): PendingSummary[] {
  if (!underRoot || !isAbsoluteFsPath(underRoot)) {
    return files;
  }
  const rootNorm = normalizeRoot(underRoot);
  const rootFs = vscode.Uri.file(underRoot).fsPath;
  return files
    .filter((f) => isUnderRoot(f.path, rootNorm))
    .map((f) => ({
      ...f,
      relativePath: (path.relative(rootFs, f.path) || f.name).split(path.sep).join('/'),
    }));
}
