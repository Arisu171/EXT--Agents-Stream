
import * as path from 'path';
import * as vscode from 'vscode';
import { isExcludedPathSegment } from './pathExclusions';
import { exceedsLineLimit, exceedsSizeLimitByBytes } from './fileSizeLimit';
import { BaselineStore } from './baselineStore';
import { isTextFile, looksBinary } from './fileTypeRules';

export class BaselineScanner {
  private static readonly DEFAULT_CONCURRENCY = 4;
  private static readonly MAX_CONCURRENCY = 16;

  constructor(private readonly store: BaselineStore) {}

  async buildInitialSnapshots(folderPath: string): Promise<void> {
    try {
      const folderUri = vscode.Uri.file(folderPath);
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folderUri, '**/*')
      );
      let nextIndex = 0;
      const workerCount = Math.min(this.readConcurrency(), uris.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < uris.length) {
          const uri = uris[nextIndex++];
          await this.snapshotFile(uri, folderPath);
        }
      });
      await Promise.all(workers);
    } catch {
    }
  }

  private readConcurrency(): number {
    const configured = vscode.workspace
      .getConfiguration('agents-check')
      .get<number>('baselineScanConcurrency', BaselineScanner.DEFAULT_CONCURRENCY);
    if (!Number.isFinite(configured)) {
      return BaselineScanner.DEFAULT_CONCURRENCY;
    }
    return Math.min(
      BaselineScanner.MAX_CONCURRENCY,
      Math.max(1, Math.floor(configured!))
    );
  }

  private async snapshotFile(uri: vscode.Uri, folderPath: string): Promise<void> {
    const fullPath = path.resolve(uri.fsPath);
    const relativePath = path.relative(path.resolve(folderPath), fullPath);
    const relativeSegments = relativePath.split(path.sep);
    if (relativeSegments.slice(0, -1).some(segment => segment.startsWith('.'))) {
      return;
    }
    if (isExcludedPathSegment(fullPath) || !isTextFile(fullPath)) {
      return;
    }
    if (this.store.hasState(fullPath)) {
      return;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (exceedsSizeLimitByBytes(stat.size)) {
        if (!this.store.hasState(fullPath)) {
          this.store.markSizeSkipped(fullPath);
        }
        return;
      }
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (looksBinary(content)) { return; }
      if (exceedsLineLimit(content)) {
        if (!this.store.hasState(fullPath)) {
          this.store.markSizeSkipped(fullPath);
        }
        return;
      }
      if (!this.store.hasState(fullPath)) {
        this.store.set(fullPath, content);
      }
    } catch {
    }
  }
}
