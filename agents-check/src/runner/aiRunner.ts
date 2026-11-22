
import { DiffManager } from '../check/diffManager';

export type StatusCallback = (
  status: 'running' | 'idle' | 'error',
  message?: string
) => void;

export type ProgressCallback = (step: string) => void;

export interface IAiRunner {
  readonly toolName: string;

  run(
    prompt: string,
    workingDir: string,
    onStatus: StatusCallback,
    onProgress?: ProgressCallback
  ): Promise<void>;

  cancel?(): void;
}
