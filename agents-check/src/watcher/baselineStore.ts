
import * as path from 'path';
import * as vscode from 'vscode';

export class BaselineStore {
  private snapshots = new Map<string, string>();
  private sizeSkipped = new Set<string>();

  private normalizePath(p: string): string {
    const fsPath = vscode.Uri.file(path.resolve(p)).fsPath;
    return process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;
  }

  get(filePath: string): string | undefined {
    return this.snapshots.get(this.normalizePath(filePath));
  }

  set(filePath: string, content: string): void {
    this.snapshots.set(this.normalizePath(filePath), content);
  }

  has(filePath: string): boolean {
    return this.snapshots.has(this.normalizePath(filePath));
  }

  hasState(filePath: string): boolean {
    const key = this.normalizePath(filePath);
    return this.snapshots.has(key) || this.sizeSkipped.has(key);
  }

  markSizeSkipped(filePath: string): void {
    const key = this.normalizePath(filePath);
    this.snapshots.delete(key);
    this.sizeSkipped.add(key);
  }

  consumeSizeSkipped(filePath: string): boolean {
    const key = this.normalizePath(filePath);
    return this.sizeSkipped.delete(key);
  }

  deleteUnder(filePath: string): void {
    const key = this.normalizePath(filePath);
    const prefix = key.endsWith(path.sep) ? key : key + path.sep;
    const matches = (p: string): boolean => p === key || p.startsWith(prefix);
    for (const p of this.snapshots.keys()) {
      if (matches(p)) { this.snapshots.delete(p); }
    }
    for (const p of this.sizeSkipped) {
      if (matches(p)) { this.sizeSkipped.delete(p); }
    }
  }

  clear(): void {
    this.snapshots.clear();
    this.sizeSkipped.clear();
  }
}
