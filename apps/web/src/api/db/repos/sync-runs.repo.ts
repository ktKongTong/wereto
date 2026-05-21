import { and, desc, eq, inArray, lte } from "drizzle-orm";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import { syncRunLogs, syncRuns, type JsonRecord } from "../schema.ts";
import { bulkInsert } from "../utils/d1-bulk-writer.ts";

type SyncRunMode = "full" | "incremental";
type SyncRunPhase =
  | "queued"
  | "workflow"
  | "bootstrap"
  | "shelf"
  | "notebooks"
  | "reading_periods"
  | "reading_years"
  | "reading_days"
  | "reading_week"
  | "book_details"
  | "highlights_reviews"
  | "commit"
  | "finalize"
  | "failed"
  | "timeout";

type SyncRunProgress = {
  current?: number;
  total?: number;
};

type SyncRunLogInput = {
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
  progressCurrent?: number;
  progressTotal?: number;
  meta?: JsonRecord | null;
  createdAt: number;
};

export class SyncRunsRepo {
  constructor(private readonly db: DB) {}

  async createWereadSyncRun() {
    const requestedAt = nowUnix();
    const [row] = await this.db
      .insert(syncRuns)
      .values({
        taskType: "weread_sync",
        source: "weread",
        status: "queued",
        phase: "queued",
        requestedAt,
        updatedAt: requestedAt,
        progressCurrent: 0,
        progressTotal: 0,
        statsJson: {},
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create sync run");
    }

    return row;
  }

  async findActiveWereadSyncRun() {
    const [row] = await this.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.taskType, "weread_sync"), inArray(syncRuns.status, ["queued", "running"])))
      .orderBy(desc(syncRuns.requestedAt))
      .limit(1);

    return row ?? null;
  }

  async findTimedOut(staleBefore: number) {
    return this.db
      .select()
      .from(syncRuns)
      .where(and(inArray(syncRuns.status, ["queued", "running"]), lte(syncRuns.updatedAt, staleBefore)));
  }

  async attachWorkflowInstance(runId: number, workflowInstanceId: string) {
    await this.db
      .update(syncRuns)
      .set({ workflowInstanceId, phase: "queued", updatedAt: nowUnix() })
      .where(eq(syncRuns.id, runId));
  }

  async failWorkflowStart(runId: number, message: string) {
    await this.fail(runId, { phase: "workflow", message });
  }

  async startBootstrap(runId: number) {
    const startedAt = nowUnix();
    await this.db
      .update(syncRuns)
      .set({
        status: "running",
        phase: "bootstrap",
        startedAt,
        updatedAt: startedAt,
      })
      .where(eq(syncRuns.id, runId));
  }

  async setMode(runId: number, mode: SyncRunMode, now = nowUnix()) {
    const [row] = await this.db.select({ statsJson: syncRuns.statsJson }).from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
    await this.db.update(syncRuns).set({ statsJson: { ...(row?.statsJson ?? {}), mode }, updatedAt: now }).where(eq(syncRuns.id, runId));
  }

  async setPhase(runId: number, phase: SyncRunPhase, progress: SyncRunProgress = {}, now = nowUnix()) {
    const patch: Partial<typeof syncRuns.$inferInsert> = { phase, updatedAt: now };
    if (progress.current !== undefined) patch.progressCurrent = progress.current;
    if (progress.total !== undefined) patch.progressTotal = progress.total;

    await this.db.update(syncRuns).set(patch).where(eq(syncRuns.id, runId));
  }

  async setProgress(runId: number, progress: Required<SyncRunProgress>, now = nowUnix()) {
    await this.db
      .update(syncRuns)
      .set({
        progressCurrent: progress.current,
        progressTotal: progress.total,
        updatedAt: now,
      })
      .where(eq(syncRuns.id, runId));
  }

  async finish(runId: number, result: JsonRecord, now = nowUnix()) {
    await this.db
      .update(syncRuns)
      .set({
        status: "success",
        phase: "finalize",
        finishedAt: now,
        updatedAt: now,
        resultJson: result,
      })
      .where(eq(syncRuns.id, runId));
  }

  async fail(runId: number, input: { phase?: SyncRunPhase; message: string; now?: number }) {
    const now = input.now ?? nowUnix();
    await this.db
      .update(syncRuns)
      .set({
        status: "failed",
        phase: input.phase ?? "failed",
        finishedAt: now,
        updatedAt: now,
        errorMessage: input.message,
      })
      .where(eq(syncRuns.id, runId));
  }

  async failTimedOut(runId: number, staleBefore: number) {
    const now = nowUnix();
    const [row] = await this.db
      .update(syncRuns)
      .set({
        status: "failed",
        phase: "timeout",
        finishedAt: now,
        updatedAt: now,
        errorMessage: "Sync task timed out after 15 minutes",
      })
      .where(and(eq(syncRuns.id, runId), inArray(syncRuns.status, ["queued", "running"]), lte(syncRuns.updatedAt, staleBefore)))
      .returning({ id: syncRuns.id });

    return row ?? null;
  }

  async appendLogs(runId: number, inputs: SyncRunLogInput[]) {
    await bulkInsert(this.db, syncRunLogs, inputs.map((input) => ({
      runId,
      level: input.level,
      phase: input.phase,
      message: input.message,
      progressCurrent: input.progressCurrent,
      progressTotal: input.progressTotal,
      metaJson: input.meta ?? null,
      createdAt: input.createdAt,
    })));
  }

  async getWithLogs(runId: number) {
    const [row] = await this.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
    if (!row) return null;

    const logs = await this.db.select().from(syncRunLogs).where(eq(syncRunLogs.runId, runId)).orderBy(syncRunLogs.createdAt, syncRunLogs.id);
    return {
      ...row,
      logs,
    };
  }

  async list(limit = 20) {
    return this.db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(limit);
  }
}
