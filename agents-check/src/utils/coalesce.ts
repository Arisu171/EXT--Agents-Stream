export interface Coalesced {
  schedule(): void;
  dispose(): void;
}

export function coalesce(fn: () => void, waitMs = 100, maxWaitMs = 500): Coalesced {
  let timer: NodeJS.Timeout | undefined;
  let firstScheduledAt = 0;

  const run = (): void => {
    timer = undefined;
    fn();
  };

  return {
    schedule(): void {
      const now = Date.now();
      if (timer) {
        clearTimeout(timer);
      } else {
        firstScheduledAt = now;
      }
      const delay = Math.max(0, Math.min(waitMs, firstScheduledAt + maxWaitMs - now));
      timer = setTimeout(run, delay);
    },
    dispose(): void {
      if (timer) { clearTimeout(timer); }
      timer = undefined;
    },
  };
}
