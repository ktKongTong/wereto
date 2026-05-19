import type { AppDb } from "./db/client.ts";
import { syncRunLogs } from "./db/schema.ts";

export type SyncLogOptions = {
  progressCurrent?: number;
  progressTotal?: number;
  meta?: unknown;
};

export class SyncRunLogger {
  constructor(
    private readonly db: AppDb,
    private readonly runId: number,
  ) {}

  info(phase: string, message: string, options?: SyncLogOptions) {
    return this.write("info", phase, message, options);
  }

  warn(phase: string, message: string, options?: SyncLogOptions) {
    return this.write("warn", phase, message, options);
  }

  error(phase: string, message: string, options?: SyncLogOptions) {
    return this.write("error", phase, message, options);
  }

  private async write(
    level: "info" | "warn" | "error",
    phase: string,
    message: string,
    options: SyncLogOptions = {},
  ) {
    await this.db.insert(syncRunLogs).values({
      runId: this.runId,
      level,
      phase,
      message,
      progressCurrent: options.progressCurrent,
      progressTotal: options.progressTotal,
      metaJson: options.meta ? JSON.stringify(options.meta) : null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }
}
