import type { JsonRecord } from "./db/schema.ts";
import { getSyncRunState, type SyncRunStateEnv } from "./do/sync-run-state.ts";
import { nowUnix } from "./time.ts";

export type SyncLogOptions = {
  meta?: JsonRecord;
  workerId?: string;
};

type SyncLogLevel = "info" | "warn" | "error";

export class SyncRunLogger {
  constructor(
    private readonly state: ReturnType<typeof getSyncRunState>,
    private readonly runId: number,
  ) {}

  async phaseStarted(phaseId: string, input: { phaseName?: string; taskName?: string; totalTask?: number; totalWorkers?: number } = {}) {
    await this.state.startNewPhase({
      phaseId,
      phaseName: input.phaseName ?? phaseId,
      taskName: input.taskName ?? "task",
      totalTask: input.totalTask ?? 0,
      totalWorkers: input.totalWorkers ?? 0,
    });
  }

  async workerStarted(phaseId: string, workerId: string, claimedTask?: number) {
    await this.state.workerClaimStart(workerId, phaseId, claimedTask);
  }

  async workerRunning(phaseId: string, workerId: string, count: number) {
    await this.state.workerClaimRunningTask(workerId, count, phaseId);
  }

  async workerDone(phaseId: string, workerId: string, count: number, message?: string, options?: SyncLogOptions) {
    await this.state.workerClaimFinished(workerId, phaseId, count);
    if (message) {
      await this.write("info", phaseId, message, { ...options, workerId });
    }
  }

  async workerFailed(phaseId: string, workerId: string, count: number, message: string, options?: SyncLogOptions) {
    await this.state.failItems({ phase: phaseId, count, message, meta: options?.meta, workerId });
  }

  async info(phaseId: string, message: string, options?: SyncLogOptions) {
    await this.write("info", phaseId, message, options);
  }

  async warn(phaseId: string, message: string, options?: SyncLogOptions) {
    await this.write("warn", phaseId, message, options);
  }

  async error(phaseId: string, message: string, options?: SyncLogOptions) {
    await this.write("error", phaseId, message, options);
  }

  async runFinished(message?: string, options?: SyncLogOptions) {
    await this.state.finishRun();
    if (message) await this.write("info", "finalize", message, options);
  }

  async runFailed(message: string, options?: SyncLogOptions) {
    await this.state.failRun({ message, meta: options?.meta });
  }

  async flush() {
    await this.state.flushToD1().catch((error) => {
      console.error("Failed to persist sync state logs", error);
    });
  }

  private async write(level: SyncLogLevel, phaseId: string, message: string, options?: SyncLogOptions) {
    await this.state.workerClaimLog(phaseId, {
      runId: String(this.runId),
      workerId: options?.workerId ?? "run",
      timestamp: nowUnix(),
      level,
      message,
      meta: options?.meta ?? null,
    });
  }
}

export function createSyncRunLogger(env: SyncRunStateEnv, runId: number) {
  return new SyncRunLogger(getSyncRunState(env, runId), runId);
}
