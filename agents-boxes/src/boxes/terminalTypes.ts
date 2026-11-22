import type { TERMINAL_THEMES } from './terminalThemes';
import type { LaunchTemplate } from './launchTemplates';

export type ThemePreset = 'vscode' | 'custom' | (typeof TERMINAL_THEMES)[number]['id'];
export type CursorStyle = 'block' | 'underline' | 'bar';

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  themePreset: ThemePreset;
  customColors: TerminalColors;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
}

export interface BurstDetectionSettings {
  burstDetectionEnabled: boolean;
  burstDetectionWindowMs: number;
  burstDetectionThreshold: number;
  burstDetectionHoldMs: number;
}

export interface FocusSettings {
  preventAltMenuFocus: boolean;
}

export interface FileLimitSettings {
  maxFileLines: number;
}

export interface ExclusionSettings {
  excludedPaths: string[];
  respectGitignore: boolean;
}

export interface TerminalSettingsPayload
  extends TerminalSettings, BurstDetectionSettings, FocusSettings, FileLimitSettings {
}

export interface IdeProfileInfo {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface LaunchMenuPayload {
  profiles: IdeProfileInfo[];
  templates: LaunchTemplate[];
}

export const DEFAULT_BURST_DETECTION_SETTINGS: BurstDetectionSettings = {
  burstDetectionEnabled: true,
  burstDetectionWindowMs: 300,
  burstDetectionThreshold: 8,
  burstDetectionHoldMs: 2000,
};

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  preventAltMenuFocus: true,
};

export const DEFAULT_FILE_LIMIT_SETTINGS: FileLimitSettings = {
  maxFileLines: 5000,
};

export const DEFAULT_EXCLUSION_SETTINGS: ExclusionSettings = {
  excludedPaths: [],
  respectGitignore: true,
};

export const MAX_FILE_LINES_CEILING = 200000;

export type IncomingMessage =
  | { type: 'ready' }
  | { type: 'pendingOverlay'; open: boolean }
  | { type: 'openPendingFile'; path: string }
  | { type: 'createSession'; cols: number; rows: number; profileId?: string; templateId?: string }
  | { type: 'requestLaunchMenu' }
  | { type: 'closeSession'; id: string }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'restart'; id: string }
  | { type: 'getSettings' }
  | { type: 'updateSettings'; settings: TerminalSettingsPayload }
  | { type: 'upsertTemplate'; template: { id?: string; name: string; profileId: string; commands: string[] } }
  | { type: 'deleteTemplate'; id: string }
  | { type: 'acceptAllChanges' }
  | { type: 'requestPendingSummaries' }
  | { type: 'acceptPendingFile'; path: string }
  | { type: 'openPendingFile'; path: string }
  | { type: 'reloadWindow' }
  | { type: 'terminalFocusState'; focused: boolean }
  | { type: 'sessionTitle'; title: string }
  | { type: 'activeSession'; id: string }
  | { type: 'viewTooNarrow' }
  | { type: 'openLink'; url: string }
  | { type: 'openTerminalFile'; path: string; line?: number; col?: number };

export interface SessionSnapshot {
  id: string;
  title: string;
  rawTitle: string;
  serialized: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number;
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 14,
  themePreset: 'vscode',
  customColors: { background: '#1f1f1f', foreground: '#cccccc', cursor: '#ffffff' },
  cursorStyle: 'block',
  cursorBlink: true,
};
