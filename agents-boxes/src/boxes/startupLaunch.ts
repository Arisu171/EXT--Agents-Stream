import * as path from 'path';

export type ShellKind = 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'wsl' | 'unknown';

export interface LaunchSpec {
  shellPath: string;
  args: string[];
  injectViaStdin: boolean;
}

function baseName(shellPath: string): string {
  return path.basename(shellPath).toLowerCase();
}

export function detectShellKind(shellPath: string): ShellKind {
  const name = baseName(shellPath).replace(/\.exe$/i, '');
  if (name === 'pwsh' || name === 'powershell') {
    return 'powershell';
  }
  if (name === 'cmd') {
    return 'cmd';
  }
  if (name === 'wsl') {
    return 'wsl';
  }
  if (name === 'bash' || name === 'sh' || name === 'dash') {
    return 'bash';
  }
  if (name === 'zsh') {
    return 'zsh';
  }
  if (name === 'fish') {
    return 'fish';
  }
  return 'unknown';
}

function argsHaveFlag(args: string[], flags: string[]): boolean {
  const lower = new Set(flags.map((f) => f.toLowerCase()));
  return args.some((a) => lower.has(a.toLowerCase()));
}

function powershellAlreadyRunsCommand(args: string[]): boolean {
  return argsHaveFlag(args, ['-Command', '-c', '-EncodedCommand', '-ec', '-File', '-f']);
}

function cmdAlreadyRunsCommand(args: string[]): boolean {
  return args.some((a) => {
    const lower = a.toLowerCase();
    return lower === '/c' || lower === '/k' || lower.startsWith('/c') || lower.startsWith('/k');
  });
}

function joinCommands(commands: string[], separator: string): string {
  return commands.map((c) => c.trim()).filter(Boolean).join(separator);
}

export function buildLaunchWithStartupCommands(
  shellPath: string,
  shellArgs: string[],
  commands: string[],
): LaunchSpec {
  const cleaned = commands.map((c) => c.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { shellPath, args: shellArgs, injectViaStdin: false };
  }

  const kind = detectShellKind(shellPath);
  const args = [...shellArgs];

  switch (kind) {
    case 'powershell': {
      if (powershellAlreadyRunsCommand(args)) {
        return { shellPath, args, injectViaStdin: true };
      }
      const next = args.filter((a) => !/^-(NoExit)$/i.test(a));
      next.push('-NoExit', '-Command', joinCommands(cleaned, '; '));
      return { shellPath, args: next, injectViaStdin: false };
    }
    case 'cmd': {
      if (cmdAlreadyRunsCommand(args)) {
        return { shellPath, args, injectViaStdin: true };
      }
      return {
        shellPath,
        args: [...args, '/d', '/k', joinCommands(cleaned, ' & ')],
        injectViaStdin: false,
      };
    }
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'wsl':
    case 'unknown':
    default:
      return { shellPath, args, injectViaStdin: true };
  }
}
