
import * as vscode from 'vscode';

const DEFAULT_MAX_FILE_LINES = 5000;

const BYTES_PER_LINE_HEADROOM = 200;

let cachedMaxLines: number | undefined;

export function refreshFileSizeLimit(): void {
  const config = vscode.workspace.getConfiguration('agents-check');
  const value = config.get<number>('maxFileLines', DEFAULT_MAX_FILE_LINES);
  cachedMaxLines = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function maxLines(): number {
  if (cachedMaxLines === undefined) { refreshFileSizeLimit(); }
  return cachedMaxLines!;
}

export function exceedsSizeLimitByBytes(byteSize: number): boolean {
  const max = maxLines();
  if (max <= 0) { return false; }
  return byteSize > max * BYTES_PER_LINE_HEADROOM;
}

export function exceedsLineLimit(content: string): boolean {
  const max = maxLines();
  if (max <= 0) { return false; }

  let newlines = 0;
  let idx = content.indexOf('\n');
  while (idx !== -1) {
    if (++newlines > max) { return true; }
    idx = content.indexOf('\n', idx + 1);
  }
  const lines = content.endsWith('\n') ? newlines : newlines + 1;
  return lines > max;
}

export function currentMaxFileLines(): number {
  return maxLines();
}
