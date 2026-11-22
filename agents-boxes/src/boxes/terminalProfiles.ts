import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ResolvedTerminalProfile {
  id: string;
  label: string;
  path: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  isDefault: boolean;
}

type RawProfile = {
  path?: string | string[];
  source?: string;
  args?: string[] | string;
  env?: Record<string, string>;
  cwd?: string;
  icon?: string;
  overrideName?: boolean;
  color?: string;
};

function platformProfilesKey(): string {
  switch (process.platform) {
    case 'win32': return 'profiles.windows';
    case 'darwin': return 'profiles.osx';
    default: return 'profiles.linux';
  }
}

function platformDefaultKey(): string {
  switch (process.platform) {
    case 'win32': return 'defaultProfile.windows';
    case 'darwin': return 'defaultProfile.osx';
    default: return 'defaultProfile.linux';
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }
  return [];
}

function expandVariables(value: string): string {
  const home = os.homedir();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? home;
  let out = value
    .replace(/\$\{userHome\}/gi, home)
    .replace(/\$\{workspaceFolder\}/gi, workspaceFolder)
    .replace(/\$\{execPath\}/gi, process.execPath)
    .replace(/\$\{pathSeparator\}/gi, path.sep)
    .replace(/^~(?=$|[\\/])/, home);

  out = out.replace(/\$\{env:([^}]+)\}/gi, (_m, name: string) => {
    const v = process.env[name];
    return v !== undefined ? v : '';
  });
  return out;
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const expanded = expandVariables(candidate).trim();
    if (!expanded) {
      continue;
    }
    try {
      if (fs.existsSync(expanded)) {
        return expanded;
      }
    } catch {
    }
  }
  return undefined;
}

function isSpawnablePath(shellPath: string): boolean {
  if (!shellPath.trim()) {
    return false;
  }
  if (!path.isAbsolute(shellPath) && !/[\\/]/.test(shellPath)) {
    return true;
  }
  try {
    return fs.existsSync(shellPath);
  } catch {
    return false;
  }
}

function resolvePathField(raw: RawProfile): string | undefined {
  if (typeof raw.path === 'string' && raw.path.trim()) {
    const expanded = expandVariables(raw.path).trim();
    return isSpawnablePath(expanded) ? expanded : undefined;
  }
  if (Array.isArray(raw.path)) {
    return firstExistingPath(raw.path.filter((p): p is string => typeof p === 'string'));
  }
  return undefined;
}

function collectIdePathCandidates(rawProfiles?: Record<string, RawProfile | null>): string[] {
  const out: string[] = [];
  if (!rawProfiles) {
    return out;
  }
  for (const raw of Object.values(rawProfiles)) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    if (typeof raw.path === 'string') {
      out.push(raw.path);
    } else if (Array.isArray(raw.path)) {
      for (const p of raw.path) {
        if (typeof p === 'string') {
          out.push(p);
        }
      }
    }
  }
  return out;
}

function whereExisting(command: string, prefer?: (p: string) => number): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  try {
    const out = execFileSync('where.exe', [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    const found = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && fs.existsSync(line));
    if (found.length === 0) {
      return undefined;
    }
    if (prefer) {
      found.sort((a, b) => prefer(a) - prefer(b));
    }
    return found[0];
  } catch {
    return undefined;
  }
}

function bashBesideGit(gitExe: string): string | undefined {
  const dir = path.dirname(gitExe);
  return firstExistingPath([
    path.join(dir, 'bash.exe'),
    path.join(dir, '..', 'bin', 'bash.exe'),
    path.join(dir, '..', '..', 'bin', 'bash.exe'),
    path.join(dir, '..', 'usr', 'bin', 'bash.exe'),
  ]);
}

function findExecutable(
  basenameRe: RegExp,
  options: {
    rawProfiles?: Record<string, RawProfile | null>;
    whereNames?: string[];
    extraCandidates?: string[];
    preferWhere?: (p: string) => number;
    fromGitOnPath?: boolean;
  } = {}
): string | undefined {
  const ideHit = firstExistingPath(
    collectIdePathCandidates(options.rawProfiles).filter((p) =>
      basenameRe.test(expandVariables(p))
    )
  );
  if (ideHit) {
    return ideHit;
  }

  const extras = firstExistingPath(options.extraCandidates ?? []);
  if (extras) {
    return extras;
  }

  if (options.fromGitOnPath) {
    const git = whereExisting('git');
    if (git) {
      const bash = bashBesideGit(git);
      if (bash) {
        return bash;
      }
    }
  }

  for (const name of options.whereNames ?? []) {
    const hit = whereExisting(name, options.preferWhere);
    if (!hit) {
      continue;
    }
    if (/bash\.exe$/i.test(hit) && /(?:^|[\\/])(?:System32|WindowsApps)[\\/]/i.test(hit)) {
      continue;
    }
    if (basenameRe.test(hit) || basenameRe.test(path.basename(hit))) {
      return hit;
    }
  }

  return undefined;
}

function findGitBashExecutable(rawProfiles?: Record<string, RawProfile | null>): string | undefined {
  return findExecutable(/bash\.exe$/i, {
    rawProfiles,
    fromGitOnPath: true,
    whereNames: ['bash'],
    extraCandidates: [
      process.env['GIT_INSTALL_ROOT']
        ? path.join(process.env['GIT_INSTALL_ROOT'], 'bin', 'bash.exe')
        : '',
      path.join(process.env['ProgramFiles'] ?? '', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? '', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['LocalAppData'] ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean),
    preferWhere: (p) => (/system32|windowsapps/i.test(p) ? 1 : 0),
  });
}

function findPowerShellExecutable(rawProfiles?: Record<string, RawProfile | null>): string | undefined {
  return findExecutable(/powershell\.exe$/i, {
    rawProfiles,
    whereNames: ['powershell'],
    extraCandidates: [
      path.join(
        process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      path.join(
        process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows',
        'SysWOW64',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
    ],
  });
}

function findPwshExecutable(rawProfiles?: Record<string, RawProfile | null>): string | undefined {
  return findExecutable(/pwsh\.exe$/i, {
    rawProfiles,
    whereNames: ['pwsh'],
    extraCandidates: [
      path.join(process.env['ProgramFiles'] ?? '', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env['ProgramFiles'] ?? '', 'PowerShell', '7-preview', 'pwsh.exe'),
    ].filter((p) => p.length > 'pwsh.exe'.length),
  });
}

function findCmdExecutable(rawProfiles?: Record<string, RawProfile | null>): string | undefined {
  const comSpec = process.env['ComSpec'];
  if (comSpec && fs.existsSync(comSpec)) {
    return comSpec;
  }
  const windir = process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows';
  return findExecutable(/cmd\.exe$/i, {
    rawProfiles,
    whereNames: ['cmd'],
    extraCandidates: [
      path.join(windir, 'Sysnative', 'cmd.exe'),
      path.join(windir, 'System32', 'cmd.exe'),
    ],
  });
}

function findWslExecutable(rawProfiles?: Record<string, RawProfile | null>): string | undefined {
  const windir = process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows';
  return findExecutable(/wsl\.exe$/i, {
    rawProfiles,
    whereNames: ['wsl'],
    extraCandidates: [
      path.join(windir, 'System32', 'wsl.exe'),
      path.join(windir, 'Sysnative', 'wsl.exe'),
    ],
    preferWhere: (p) => (/windowsapps/i.test(p) ? 1 : /system32/i.test(p) ? 0 : 2),
  });
}

function resolveSourceProfile(
  source: string,
  rawProfiles?: Record<string, RawProfile | null>
): { path: string; args: string[] } | undefined {
  const lower = source.toLowerCase().replace(/\s+/g, '');
  if (lower === 'powershell') {
    const exe = findPowerShellExecutable(rawProfiles);
    return exe ? { path: exe, args: [] } : undefined;
  }
  if (lower === 'pwsh') {
    const exe = findPwshExecutable(rawProfiles);
    return exe ? { path: exe, args: [] } : undefined;
  }
  if (lower === 'gitbash') {
    const bash = findGitBashExecutable(rawProfiles);
    if (!bash) {
      return undefined;
    }
    return { path: bash, args: ['-i'] };
  }
  if (lower === 'wsl') {
    const exe = findWslExecutable(rawProfiles);
    return exe ? { path: exe, args: [] } : undefined;
  }
  if (lower === 'cmd' || lower === 'commandprompt') {
    const exe = findCmdExecutable(rawProfiles);
    return exe ? { path: exe, args: [] } : undefined;
  }
  return undefined;
}

function readMergedRawProfiles(): Record<string, RawProfile | null> {
  const config = vscode.workspace.getConfiguration('terminal.integrated');
  const profilesKey = platformProfilesKey();
  const inspected = config.inspect<Record<string, RawProfile | null>>(profilesKey);
  const merged: Record<string, RawProfile | null> = {
    ...(inspected?.defaultValue ?? {}),
    ...(inspected?.globalValue ?? {}),
    ...(inspected?.workspaceValue ?? {}),
    ...(inspected?.workspaceFolderValue ?? {}),
  };

  if (Object.keys(merged).length === 0) {
    const viaGet = config.get<Record<string, RawProfile | null>>(profilesKey);
    if (viaGet) {
      Object.assign(merged, viaGet);
    }
  }
  return merged;
}

let wslDistroCache: { at: number; names: string[] } | undefined;
const WSL_DISTRO_TTL_MS = 60_000;

function listWslDistros(wslExe?: string): string[] {
  if (process.platform !== 'win32') {
    return [];
  }
  const now = Date.now();
  if (wslDistroCache && now - wslDistroCache.at < WSL_DISTRO_TTL_MS) {
    return wslDistroCache.names;
  }
  const exe = wslExe || findWslExecutable();
  if (!exe) {
    wslDistroCache = { at: now, names: [] };
    return [];
  }
  try {
    const buf = execFileSync(exe, ['-l', '-q'], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'buffer',
    }) as Buffer;
    let text: string;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      text = buf.toString('utf16le');
    } else if (buf.includes(0x00)) {
      text = buf.toString('utf16le');
    } else {
      text = buf.toString('utf8');
    }
    const names = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter((line) => line.length > 0 && !/^windows subsystem/i.test(line));
    wslDistroCache = { at: now, names };
    return names;
  } catch {
    wslDistroCache = { at: now, names: [] };
    return [];
  }
}

let profileListCache: { at: number; profiles: ResolvedTerminalProfile[] } | undefined;
const PROFILE_LIST_TTL_MS = 5_000;

function ensureExtraWindowsProfiles(
  results: ResolvedTerminalProfile[],
  seenIds: Set<string>,
  rawProfiles: Record<string, RawProfile | null>
): void {
  if (process.platform !== 'win32') {
    return;
  }

  const gitBash = findGitBashExecutable(rawProfiles);
  if (
    gitBash &&
    !results.some((p) => /bash\.exe$/i.test(p.path) || /git\s*bash/i.test(p.id))
  ) {
    const id = 'Git Bash';
    if (!seenIds.has(id)) {
      results.push({
        id,
        label: id,
        path: gitBash,
        args: ['-i'],
        isDefault: false,
      });
      seenIds.add(id);
    }
  }

  const wslExe = findWslExecutable(rawProfiles);
  if (!wslExe) {
    return;
  }

  for (const distro of listWslDistros(wslExe)) {
    const id = distro;
    if (seenIds.has(id)) {
      continue;
    }
    const already = results.some(
      (p) =>
        /wsl\.exe$/i.test(p.path) &&
        p.args.some((a) => a === distro || a.toLowerCase() === distro.toLowerCase())
    );
    if (already) {
      continue;
    }
    results.push({
      id,
      label: distro,
      path: wslExe,
      args: ['-d', distro],
      isDefault: false,
    });
    seenIds.add(id);
  }
}

function fallbackShell(rawProfiles?: Record<string, RawProfile | null>): { path: string; args: string[]; label: string } {
  if (process.platform === 'win32') {
    const resolved =
      findPowerShellExecutable(rawProfiles) ||
      findCmdExecutable(rawProfiles) ||
      (vscode.env.shell && isSpawnablePath(vscode.env.shell) ? vscode.env.shell : undefined);
    if (resolved) {
      return {
        path: resolved,
        args: [],
        label: path.basename(resolved).replace(/\.exe$/i, ''),
      };
    }
  }
  const shell =
    vscode.env.shell ||
    process.env['ComSpec'] ||
    (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
  const label = path.basename(shell).replace(/\.exe$/i, '');
  return { path: shell, args: [], label };
}

export function listIdeTerminalProfiles(): ResolvedTerminalProfile[] {
  const now = Date.now();
  if (profileListCache && now - profileListCache.at < PROFILE_LIST_TTL_MS) {
    return profileListCache.profiles;
  }

  const config = vscode.workspace.getConfiguration('terminal.integrated');
  const defaultKey = platformDefaultKey();
  const rawProfiles = readMergedRawProfiles();
  const defaultName = config.get<string>(defaultKey) ?? undefined;

  const results: ResolvedTerminalProfile[] = [];
  const seenIds = new Set<string>();

  for (const [name, raw] of Object.entries(rawProfiles)) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    let resolvedPath = resolvePathField(raw);
    let args = asStringArray(raw.args).map(expandVariables);
    if (
      resolvedPath &&
      /(?:^|[\\/])bash\.exe$/i.test(resolvedPath) &&
      args.includes('--login')
    ) {
      args = args.filter((a) => a !== '--login');
      if (!args.includes('-i')) {
        args = ['-i', ...args];
      }
    }
    if (!resolvedPath && typeof raw.source === 'string') {
      const fromSource = resolveSourceProfile(raw.source, rawProfiles);
      if (fromSource) {
        resolvedPath = fromSource.path;
        if (args.length === 0) {
          args = fromSource.args;
        }
      }
    }
    if (!resolvedPath || !isSpawnablePath(resolvedPath)) {
      continue;
    }
    results.push({
      id: name,
      label: name,
      path: resolvedPath,
      args,
      env: raw.env,
      cwd: typeof raw.cwd === 'string' ? expandVariables(raw.cwd) : undefined,
      isDefault: defaultName === name,
    });
    seenIds.add(name);
  }

  ensureExtraWindowsProfiles(results, seenIds, rawProfiles);

  if (results.length === 0) {
    const fb = fallbackShell(rawProfiles);
    results.push({
      id: fb.label,
      label: fb.label,
      path: fb.path,
      args: fb.args,
      isDefault: true,
    });
  } else if (!results.some((p) => p.isDefault)) {
    results[0].isDefault = true;
  }

  profileListCache = { at: now, profiles: results };
  return results;
}

export function getDefaultIdeProfile(): ResolvedTerminalProfile {
  const profiles = listIdeTerminalProfiles();
  return profiles.find((p) => p.isDefault) ?? profiles[0];
}

export function findIdeProfile(profileId: string | undefined): ResolvedTerminalProfile | undefined {
  if (!profileId) {
    return undefined;
  }
  return listIdeTerminalProfiles().find((p) => p.id === profileId);
}

export function resolveSessionCwd(profile?: ResolvedTerminalProfile): string {
  if (profile?.cwd) {
    return expandVariables(profile.cwd);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}
