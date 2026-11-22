
export interface BurstMeterConfig {
  enabled: boolean;
  windowMs: number;
  threshold: number;
}

export const DEFAULT_BURST_METER_CONFIG: BurstMeterConfig = {
  enabled: true,
  windowMs: 300,
  threshold: 8,
};

export class WriteBurstMeter {
  private timestamps: number[] = [];
  private burstActive = false;

  constructor(private config: BurstMeterConfig = DEFAULT_BURST_METER_CONFIG) {}

  updateConfig(config: BurstMeterConfig): void {
    this.config = config;
    if (!config.enabled) {
      this.timestamps = [];
      this.burstActive = false;
    }
  }

  record(filePath: string): boolean {
    if (!this.config.enabled) { return false; }

    const now = Date.now();
    this.timestamps.push(now);
    this.trim(now);

    const count = this.timestamps.length;
    const isBurst = count >= this.config.threshold;
    if (isBurst) {
      if (!this.burstActive) {
        this.burstActive = true;
        console.log(
          `[agents-check burst-meter] ${count} files changed within ${this.config.windowMs}ms ` +
          `(threshold ${this.config.threshold}); latest: ${filePath}`
        );
      }
    } else {
      this.burstActive = false;
    }
    return isBurst;
  }

  private trim(now: number): void {
    while (this.timestamps.length > 0 && now - this.timestamps[0] > this.config.windowMs) {
      this.timestamps.shift();
    }
  }
}
