import type { SyncRunsRepo } from "./db/repos/sync-runs.repo.ts";
import type { JsonRecord } from "./db/schema.ts";
import { nowUnix } from "./time.ts";

export type SyncLogOptions = {
  progressCurrent?: number;
  progressTotal?: number;
  meta?: JsonRecord;
};

type BufferedSyncLog = {
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
  progressCurrent?: number;
  progressTotal?: number;
  meta?: JsonRecord | null;
  createdAt: number;
};

const LOG_FLUSH_DELAY_MS = 500;

export class SyncRunLogger {
  private buffer: BufferedSyncLog[] = [];
  private pendingFlush: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly runsRepo: SyncRunsRepo,
    private readonly runId: number,
  ) {}

  info(phase: string, message: string, options?: SyncLogOptions) {
    this.enqueue("info", phase, message, options);
  }

  warn(phase: string, message: string, options?: SyncLogOptions) {
    this.enqueue("warn", phase, message, options);
  }

  error(phase: string, message: string, options?: SyncLogOptions) {
    this.enqueue("error", phase, message, options);
  }

  async flush() {
    this.cancelScheduledFlush();
    await this.flushNow();
    await this.pendingFlush.catch(() => undefined);
  }

  private enqueue(level: "info" | "warn" | "error", phase: string, message: string, options?: SyncLogOptions) {
    this.buffer.push({
      level,
      phase,
      message,
      progressCurrent: options?.progressCurrent,
      progressTotal: options?.progressTotal,
      meta: options?.meta ?? null,
      createdAt: nowUnix(),
    });

    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, LOG_FLUSH_DELAY_MS);
  }

  private cancelScheduledFlush() {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async flushNow() {
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    this.pendingFlush = this.pendingFlush
      .catch(() => undefined)
      .then(() => this.runsRepo.appendLogs(this.runId, rows))
      .catch((error) => {
        console.error("Failed to write sync logs", error);
      });

    await this.pendingFlush;
  }
}
