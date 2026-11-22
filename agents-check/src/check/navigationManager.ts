import * as vscode from 'vscode';
import * as path from 'path';
import { DiffManager } from './diffManager';
import { notify } from '../utils/notify';

function normalizePath(filePath: string): string {
  const fsPath = vscode.Uri.file(path.resolve(filePath)).fsPath;
  return process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;
}

export class NavigationManager {
  constructor(private readonly diffManager: DiffManager) {}

  async nextFile(): Promise<void> {
    await this.navigate(1);
  }

  async prevFile(): Promise<void> {
    await this.navigate(-1);
  }

  private async navigate(direction: number): Promise<void> {
    const count = this.diffManager.getPendingCount();
    if (count === 0) {
      notify('No files with pending diffs.');
      return;
    }

    const currentEditor = vscode.window.activeTextEditor;
    const currentPath = currentEditor ? normalizePath(currentEditor.document.uri.fsPath) : '';

    if (count === 1) {
      const onlyFile = this.diffManager.getPendingFileAt(0)!;
      if (normalizePath(onlyFile) !== currentPath) {
        await this.diffManager.openDiff(onlyFile);
      }
      return;
    }

    let currentIndex = currentPath ? this.diffManager.getPendingIndex(currentPath) : -1;
    if (currentIndex === -1) {
      currentIndex = direction > 0 ? 0 : count - 1;
    } else {
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= count) {
        return;
      }
      currentIndex = targetIndex;
    }

    const targetPath = this.diffManager.getPendingFileAt(currentIndex)!;
    await this.diffManager.openDiff(targetPath);
  }

  getNavigationInfo(currentFilePath: string) {
    const count = this.diffManager.getPendingCount();
    if (count === 0) { return undefined; }

    if (count === 1) {
      const onlyFile = this.diffManager.getPendingFileAt(0)!;
      const onlyName = path.basename(onlyFile);
      return {
        currentIdx: 1,
        total: 1,
        prevName: onlyName,
        nextName: onlyName,
        canPrev: true,
        canNext: true,
      };
    }

    const rawIndex = this.diffManager.getPendingIndex(currentFilePath);

    if (rawIndex === -1) {
      const first = this.diffManager.getPendingFileAt(0)!;
      const last = this.diffManager.getPendingFileAt(count - 1)!;
      return {
        currentIdx: 1,
        total: count,
        prevName: path.basename(last),
        nextName: path.basename(first),
        canPrev: true,
        canNext: true,
      };
    }

    const currentIndex = rawIndex;
    const canPrev = currentIndex > 0;
    const canNext = currentIndex < count - 1;
    const prevName = canPrev ? path.basename(this.diffManager.getPendingFileAt(currentIndex - 1)!) : '';
    const nextName = canNext ? path.basename(this.diffManager.getPendingFileAt(currentIndex + 1)!) : '';

    return {
      currentIdx: currentIndex + 1,
      total: count,
      prevName,
      nextName,
      canPrev,
      canNext,
    };
  }
}
