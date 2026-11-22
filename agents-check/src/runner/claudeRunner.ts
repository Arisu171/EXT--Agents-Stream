import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DiffManager } from '../check/diffManager';
import { IAiRunner, StatusCallback, ProgressCallback } from './aiRunner';

interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: {
    file_path?: string;
    [key: string]: unknown;
  };
}

interface AssistantMessage {
  role: 'assistant';
  content: Array<ToolUseContent | { type: string }>;
}

interface AssistantEvent {
  type: 'assistant';
  message: AssistantMessage;
}

interface ToolResultEvent {
  type: 'tool';
  tool_use_id: string;
  content: string;
}

interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error_during_execution' | 'error_max_turns';
  is_error: boolean;
  result?: string;
}

type ClaudeEvent =
  | AssistantEvent
  | ToolResultEvent
  | ResultEvent
  | { type: string };

const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export type { StatusCallback, ProgressCallback };

export class ClaudeRunner implements IAiRunner {
  readonly toolName = 'claude';
  private currentProc: cp.ChildProcess | undefined;

  constructor(private readonly diffManager: DiffManager) {}

  cancel(): void {
    try {
      this.currentProc?.kill();
    } catch {
    }
    this.currentProc = undefined;
  }

  private resolveToolFilePath(filePath: string, workingDir: string): string {
    if (path.isAbsolute(filePath)) { return filePath; }
    return path.resolve(workingDir, filePath);
  }

  private findClaudeCli(): string {
    const candidates = ['claude', 'claude.cmd', 'claude.exe'];

    const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
    for (const candidate of candidates) {
      try {
        const result = cp.spawnSync(
          lookupCmd,
          [candidate.replace(/\.(cmd|exe)$/, '')],
          { encoding: 'utf8', timeout: 3000 }
        );
        if (result.status === 0 && result.stdout.trim()) {
          return candidate;
        }
      } catch {
      }
    }

    const homeDir =
      process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
    if (homeDir) {
      const absolutePath = path.join(homeDir, '.local', 'bin', 'claude.exe');
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
      const absolutePathNoExt = path.join(homeDir, '.local', 'bin', 'claude');
      if (fs.existsSync(absolutePathNoExt)) {
        return absolutePathNoExt;
      }
    }

    throw new Error(
      'claude CLI not found.\n' +
        'Install Claude Code and ensure "claude" is on your PATH.\n' +
        'Tip: add %USERPROFILE%\\.local\\bin to your PATH environment variable.'
    );
  }

  async run(
    prompt: string,
    workingDir: string,
    onStatus: StatusCallback,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const claudePath = this.findClaudeCli();

    return new Promise<void>((resolve, reject) => {
      const args = [
        '--output-format', 'stream-json',
        '--verbose',
        '-p', prompt,
      ];

      const proc = cp.spawn(claudePath, args, {
        cwd: workingDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.currentProc = proc;

      let lineBuffer = '';

      const pendingToolUses = new Map<string, string>();

      onProgress?.('Claude is thinking\u2026');

      proc.stdout.on('data', (chunk: Buffer) => {
        lineBuffer += chunk.toString('utf8');

        const lines = lineBuffer.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = (lines[i] ?? '').trim();
          if (line.length > 0) {
            this.handleLine(line, pendingToolUses, workingDir, onProgress);
          }
        }
        lineBuffer = lines[lines.length - 1] ?? '';
      });

      proc.stdout.on('end', () => {
        const remaining = lineBuffer.trim();
        if (remaining.length > 0) {
          this.handleLine(remaining, pendingToolUses, workingDir, onProgress);
        }
        lineBuffer = '';
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        console.error('[claude stderr]', chunk.toString('utf8').trimEnd());
      });

      onStatus('running');

      proc.on('close', (code) => {
        if (this.currentProc === proc) { this.currentProc = undefined; }
        onStatus('idle');
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`claude exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        if (this.currentProc === proc) { this.currentProc = undefined; }
        onStatus('error', err.message);
        reject(err);
      });
    });
  }

  private handleLine(
    line: string,
    pendingToolUses: Map<string, string>,
    workingDir: string,
    onProgress?: ProgressCallback
  ): void {
    let event: ClaudeEvent;
    try {
      event = JSON.parse(line) as ClaudeEvent;
    } catch {
      console.warn(
        '[agents-check] Skipping non-JSON line:',
        line.slice(0, 120)
      );
      return;
    }

    if (event.type === 'assistant') {
      const assistantEvent = event as AssistantEvent;
      for (const item of assistantEvent.message.content) {
        if (item.type !== 'tool_use') {
          continue;
        }
        const toolUse = item as ToolUseContent;
        if (!FILE_EDIT_TOOLS.has(toolUse.name)) {
          continue;
        }
        const filePathRaw = toolUse.input.file_path;
        if (!filePathRaw) {
          continue;
        }
        const filePath = this.resolveToolFilePath(filePathRaw, workingDir);
        pendingToolUses.set(toolUse.id, filePath);
        const basename = filePath.split(/[\\/]/).pop() ?? filePath;
        onProgress?.(`${toolUse.name}: ${basename}`);
        this.diffManager.snapshotBefore(filePath).catch((err: unknown) => {
          console.error('[agents-check] snapshotBefore failed:', err);
        });
      }
      return;
    }

    if (event.type === 'tool') {
      const toolEvent = event as ToolResultEvent;
      const filePath = pendingToolUses.get(toolEvent.tool_use_id);
      if (filePath) {
        pendingToolUses.delete(toolEvent.tool_use_id);
        const basename = filePath.split(/[\\/]/).pop() ?? filePath;
        onProgress?.(`Pending: ${basename}`);
      }
      return;
    }

    if (event.type === 'result' && (event as ResultEvent).is_error) {
      console.error(
        '[agents-check] Session error:',
        (event as ResultEvent).result ?? '(no details)'
      );
    }
  }
}
