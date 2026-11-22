import * as path from 'path';

const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function isAbsoluteFsPath(p: string): boolean {
  if (!p) {
    return false;
  }
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
  }
  return p.startsWith('/');
}

export function extractCwdFromOutput(chunk: string, currentCwd: string): string {
  let cwd = currentCwd;

  const osc633 = /(?:\x1b|\x9d)]633;P;Cwd=([^\x07\x1b]+)(?:\x07|\x1b\\)/g;
  let m: RegExpExecArray | null;
  while ((m = osc633.exec(chunk)) !== null) {
    const next = sanitizeCwd(m[1]);
    if (next) {
      cwd = next;
    }
  }

  const osc7 = /(?:\x1b|\x9d)]7;([^\x07\x1b]+)(?:\x07|\x1b\\)/g;
  while ((m = osc7.exec(chunk)) !== null) {
    const next = cwdFromFileUrl(m[1]);
    if (next) {
      cwd = next;
    }
  }

  const plain = chunk.replace(ANSI_OSC, '').replace(ANSI_CSI, '');
  const psPrompt = /(?:^|[\r\n])PS\s+([A-Za-z]:[^>\r\n]+?)>\s*/g;
  while ((m = psPrompt.exec(plain)) !== null) {
    const next = sanitizeCwd(m[1]);
    if (next) {
      cwd = next;
    }
  }

  return cwd;
}

function cwdFromFileUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('file://')) {
    return sanitizeCwd(trimmed);
  }
  try {
    let rest = trimmed.slice('file://'.length);
    if (rest.startsWith('/')) {
      rest = rest.slice(1);
    }
    const slash = rest.indexOf('/');
    if (slash > 0 && /^[A-Za-z]:/.test(rest.slice(slash + 1))) {
      rest = rest.slice(slash + 1);
    }
    return sanitizeCwd(decodeURIComponent(rest));
  } catch {
    return undefined;
  }
}

function sanitizeCwd(raw: string): string | undefined {
  const cleaned = raw
    .replace(ANSI_CSI, '')
    .replace(ANSI_OSC, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!cleaned || /[\r\n\x00]/.test(cleaned)) {
    return undefined;
  }
  if (!isAbsoluteFsPath(cleaned)) {
    return undefined;
  }
  try {
    return path.resolve(cleaned);
  } catch {
    return undefined;
  }
}
