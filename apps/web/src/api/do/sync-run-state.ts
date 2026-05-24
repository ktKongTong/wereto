import { DurableObject } from "cloudflare:workers";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { getDB, type DbEnv } from "../db/client.ts";
import { SyncRunsRepo } from "../db/repos/sync-runs.repo.ts";
import type { JsonRecord } from "../db/schema.ts";
import { nowUnix } from "../time.ts";

export type SyncRunStateEnv = DbEnv & {
  WEREAD_SYNC_STATE: DurableObjectNamespace<SyncRunStateObject>;
};

export type SyncProgressEvent =
  | {
      type: "log";
      level: "info" | "warn" | "error";
      phase: string;
      message: string;
      meta?: JsonRecord | null;
      createdAt?: number;
      workerId?: string;
    }
  | {
      type: "startPhase";
      phase: string;
      total: number;
      label?: string;
      meta?: JsonRecord | null;
      dedupeKey?: string;
      createdAt?: number;
    }
  | {
      type: "completeItems";
      phase: string;
      count?: number;
      message?: string;
      meta?: JsonRecord | null;
      dedupeKey?: string;
      createdAt?: number;
      workerId?: string;
    }
  | {
      type: "failItems";
      phase: string;
      count?: number;
      message: string;
      meta?: JsonRecord | null;
      dedupeKey?: string;
      createdAt?: number;
      workerId?: string;
    }
  | {
      type: "finishRun";
      message?: string;
      meta?: JsonRecord | null;
      createdAt?: number;
    }
  | {
      type: "failRun";
      message: string;
      meta?: JsonRecord | null;
      createdAt?: number;
    };

export type SyncPhaseSnapshot = {
  phaseId: string;
  phaseName: string;
  taskName: string;
  totalWorkers: number;
  runningWorkers: number;
  totalTask: number;
  runningTask: number;
  finishedTask: number;
  failedTask: number;
  skippedTask: number;
};

export type SyncRunLogEntry = {
  id: number;
  runId: number;
  seq: number;
  level: "info" | "warn" | "error";
  phase: string;
  phaseId: string;
  phaseName: string | null;
  workerId: string | null;
  message: string;
  progressCurrent: number | null;
  progressTotal: number | null;
  metaJson: JsonRecord | null;
  createdAt: number;
};

export type SyncRunLiveSnapshot = {
  status: string;
  phase: string;
  progressCurrent: number;
  progressTotal: number;
  phases: Record<string, { total: number; completed: number; failed: number; skipped: number }>;
  phaseSteps: SyncPhaseSnapshot[];
  phaseLogs: Array<SyncPhaseSnapshot & { logs: SyncRunLogEntry[] }>;
  logs: SyncRunLogEntry[];
};

export type LogEntry = {
  runId: string;
  workerId: string;
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  meta?: JsonRecord | null;
};

export type StartPhaseRequest = {
  phaseId: string;
  phaseName: string;
  taskName: string;
  totalWorkers?: number;
  runningWorkers?: number;
  totalTask?: number;
  runningTask?: number;
  finishedTask?: number;
  failedTask?: number;
  skippedTask?: number;
};

type WorkerState = {
  id: string;
  phaseId: string;
  claimedSubTask?: number;
  runningTask?: number;
  finishedTask: number;
};

const syncStateLogs = sqliteTable("logs", {
  seq: integer("seq").primaryKey(),
  runId: integer("run_id").notNull(),
  phaseId: text("phase_id").notNull(),
  phaseName: text("phase_name").notNull(),
  workerId: text("worker_id"),
  level: text("level").$type<"info" | "warn" | "error">().notNull(),
  message: text("message").notNull(),
  progressCurrent: integer("progress_current"),
  progressTotal: integer("progress_total"),
  metaJson: text("meta_json", { mode: "json" }).$type<JsonRecord | null>(),
  createdAt: integer("created_at").notNull(),
  persisted: integer("persisted").notNull().default(0),
});

const syncStateSchema = { syncStateLogs };
const syncStateMigrations = {
  "20260522050000_sync_run_state_logs": `
CREATE TABLE IF NOT EXISTS logs (
  seq integer primary key,
  run_id integer not null,
  phase_id text not null,
  phase_name text not null,
  worker_id text,
  level text not null,
  message text not null,
  progress_current integer,
  progress_total integer,
  meta_json text,
  created_at integer not null,
  persisted integer not null default 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS logs_phase_seq_idx ON logs (phase_id, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS logs_persisted_seq_idx ON logs (persisted, seq);
`,
};

export class SyncRunStateObject extends DurableObject<SyncRunStateEnv> {
  private readonly db: DrizzleSqliteDODatabase<typeof syncStateSchema>;
  private phaseStore = new Map<string, SyncPhaseSnapshot>();
  private workers = new Map<string, WorkerState>();
  private status = "queued";
  private activePhaseId = "queued";
  private nextLogSeq = 1;

  constructor(ctx: DurableObjectState, env: SyncRunStateEnv) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema: syncStateSchema, logger: false });
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.db, { migrations: syncStateMigrations });
      this.status = await this.ctx.storage.get<string>("status") ?? "queued";
      this.activePhaseId = await this.ctx.storage.get<string>("activePhaseId") ?? "queued";
      this.nextLogSeq = await this.ctx.storage.get<number>("nextLogSeq") ?? 1;
      this.phaseStore = new Map((await this.ctx.storage.get<SyncPhaseSnapshot[]>("phases") ?? []).map((phase) => [phase.phaseId, phase]));
      this.workers = new Map((await this.ctx.storage.get<WorkerState[]>("workers") ?? []).map((worker) => [worker.id, worker]));
    });
  }

  async appendMany(events: SyncProgressEvent[]) {
    for (const event of events) {
      await this.applyEvent(event);
    }
  }

  async startPhase(input: { phase: string; total: number; label?: string; meta?: JsonRecord }) {
    await this.startNewPhase({
      phaseId: input.phase,
      phaseName: input.label ?? input.phase,
      taskName: phaseTaskName(input.phase),
      totalTask: input.total,
    });
    await this.appendLog("info", input.phase, input.label ?? "阶段开始", {
      meta: input.meta ?? null,
      createdAt: nowUnix(),
    });
  }

  async completeItems(input: { phase: string; count?: number; message?: string; meta?: JsonRecord; workerId?: string }) {
    await this.workerClaimFinished(input.workerId ?? `worker:${input.phase}:${this.nextLogSeq}`, input.phase, input.count ?? 1);
    await this.appendLog("info", input.phase, input.message ?? `${phaseTaskName(input.phase)}完成`, {
      meta: input.meta ?? null,
      workerId: input.workerId ?? null,
      createdAt: nowUnix(),
    });
  }

  async failItems(input: { phase: string; count?: number; message: string; meta?: JsonRecord; workerId?: string }) {
    this.incrementPhase(input.phase, { failedTask: input.count ?? 1, runningTask: -(input.count ?? 1) });
    await this.appendLog("error", input.phase, input.message, {
      meta: input.meta ?? null,
      workerId: input.workerId ?? null,
      createdAt: nowUnix(),
    });
  }

  async finishRun() {
    if (this.status === "failed") return;
    this.status = "success";
    this.activePhaseId = "finalize";
    await this.persistRuntimeState();
    await this.appendLog("info", "finalize", "同步任务完成");
  }

  async failRun(input: { message: string; meta?: JsonRecord }) {
    this.status = "failed";
    this.activePhaseId = "failed";
    await this.persistRuntimeState();
    await this.appendLog("error", "failed", input.message, { meta: input.meta ?? null });
  }

  async startNewPhase(req: StartPhaseRequest) {
    const existing = this.phaseStore.get(req.phaseId);
    const next: SyncPhaseSnapshot = {
      phaseId: req.phaseId,
      phaseName: req.phaseName,
      taskName: req.taskName,
      totalWorkers: req.totalWorkers ?? existing?.totalWorkers ?? 0,
      runningWorkers: req.runningWorkers ?? existing?.runningWorkers ?? 0,
      totalTask: req.totalTask ?? existing?.totalTask ?? 0,
      runningTask: req.runningTask ?? existing?.runningTask ?? 0,
      finishedTask: req.finishedTask ?? existing?.finishedTask ?? 0,
      failedTask: req.failedTask ?? existing?.failedTask ?? 0,
      skippedTask: req.skippedTask ?? existing?.skippedTask ?? 0,
    };

    this.phaseStore.set(req.phaseId, next);
    if (this.status !== "success" && this.status !== "failed") {
      this.status = "running";
      this.activePhaseId = req.phaseId;
    }
    await this.persistRuntimeState();
  }

  async workerClaimStart(id: string, phaseId = this.activePhaseId, claimedSubTask?: number) {
    const existing = this.workers.get(id);
    if (!existing) {
      this.workers.set(id, { id, phaseId, claimedSubTask, runningTask: claimedSubTask ?? 0, finishedTask: 0 });
      this.incrementPhase(phaseId, { runningWorkers: 1 });
    } else if (existing.phaseId !== phaseId) {
      existing.phaseId = phaseId;
      if (claimedSubTask !== undefined) existing.claimedSubTask = claimedSubTask;
      this.workers.set(id, existing);
    } else if (claimedSubTask !== undefined) {
      existing.claimedSubTask = claimedSubTask;
      existing.runningTask = claimedSubTask;
      this.workers.set(id, existing);
    }
    await this.persistRuntimeState();
  }

  async workerClaimFinished(id: string, phaseId = this.activePhaseId, count = 1) {
    const worker = this.workers.get(id) ?? { id, phaseId, finishedTask: 0 };
    if (!this.workers.has(id)) {
      this.incrementPhase(phaseId, { totalWorkers: 1 });
    }
    worker.phaseId = phaseId;
    worker.finishedTask += count;
    worker.runningTask = Math.max(0, (worker.runningTask ?? 0) - count);
    this.workers.set(id, worker);
    this.incrementPhase(phaseId, { finishedTask: count, runningTask: -count });
    await this.persistRuntimeState();
  }

  async workerClaimPhaseExpectTask(id: string, count: number, phaseId = this.activePhaseId) {
    const worker = this.workers.get(id) ?? { id, phaseId, finishedTask: 0 };
    const previous = worker.claimedSubTask ?? 0;
    worker.claimedSubTask = count;
    worker.phaseId = phaseId;
    this.workers.set(id, worker);
    this.incrementPhase(phaseId, { totalTask: count - previous });
    await this.persistRuntimeState();
  }

  async workerClaimRunningTask(id: string, count: number, phaseId = this.activePhaseId) {
    const worker = this.workers.get(id) ?? { id, phaseId, finishedTask: 0 };
    const previous = worker.runningTask ?? 0;
    worker.runningTask = count;
    worker.phaseId = phaseId;
    this.workers.set(id, worker);
    this.incrementPhase(phaseId, { runningTask: count - previous });
    await this.persistRuntimeState();
  }

  async workerClaimLog(phaseId: string, entry: LogEntry) {
    await this.appendLog(entry.level, phaseId, entry.message, {
      workerId: entry.workerId,
      meta: entry.meta ?? null,
      createdAt: entry.timestamp,
    });
  }

  async log(input: { phaseId: string; workerId?: string | null; level: "info" | "warn" | "error"; message: string; meta?: JsonRecord | null; createdAt?: number }) {
    await this.appendLog(input.level, input.phaseId, input.message, {
      workerId: input.workerId ?? null,
      meta: input.meta ?? null,
      createdAt: input.createdAt,
    });
  }

  async snapshot(): Promise<SyncRunLiveSnapshot> {
    const phaseSteps = Array.from(this.phaseStore.values());
    const phaseMap = new Map(phaseSteps.map((phase) => [phase.phaseId, phase]));
    const logs = (await this.db.select().from(syncStateLogs).orderBy(asc(syncStateLogs.seq)).limit(500)).map((row) =>
      this.toLogEntry(row)
    );
    const grouped = new Map<string, SyncRunLogEntry[]>();
    for (const log of logs) {
      grouped.set(log.phaseId, [...(grouped.get(log.phaseId) ?? []), log]);
    }
    const active = phaseMap.get(this.activePhaseId);

    return {
      status: this.status,
      phase: this.activePhaseId,
      progressCurrent: active?.finishedTask ?? 0,
      progressTotal: active?.totalTask ?? 0,
      phases: Object.fromEntries(phaseSteps.map((phase) => [
        phase.phaseId,
        {
          total: phase.totalTask,
          completed: phase.finishedTask,
          failed: phase.failedTask,
          skipped: phase.skippedTask,
        },
      ])),
      phaseSteps,
      phaseLogs: phaseSteps.map((phase) => ({ ...phase, logs: grouped.get(phase.phaseId) ?? [] })),
      logs,
    };
  }

  async flushToD1() {
    const rows = await this.db.select().from(syncStateLogs).where(eq(syncStateLogs.persisted, 0)).orderBy(asc(syncStateLogs.seq));
    if (rows.length === 0) return;

    const runsRepo = new SyncRunsRepo(getDB(this.env));
    await runsRepo.appendLogs(this.runId(), rows.map((row) => ({
      seq: row.seq,
      level: row.level,
      phase: row.phaseName,
      phaseId: row.phaseId,
      phaseName: row.phaseName,
      workerId: row.workerId,
      message: row.message,
      progressCurrent: row.progressCurrent ?? undefined,
      progressTotal: row.progressTotal ?? undefined,
      meta: row.metaJson,
      createdAt: row.createdAt,
    })));

    await this.db.update(syncStateLogs)
      .set({ persisted: 1 })
      .where(inArray(syncStateLogs.seq, rows.map((row) => row.seq)));
  }

  private async applyEvent(event: SyncProgressEvent) {
    if (event.type === "log") {
      await this.appendLog(event.level, event.phase, event.message, {
        workerId: event.workerId ?? null,
        meta: event.meta ?? null,
        createdAt: event.createdAt,
      });
      return;
    }

    if (event.type === "startPhase") {
      await this.startNewPhase({
        phaseId: event.phase,
        phaseName: event.label ?? phaseLabel(event.phase),
        taskName: phaseTaskName(event.phase),
        totalTask: Math.max(0, event.total),
      });
      await this.appendLog("info", event.phase, event.label ?? "阶段开始", {
        meta: event.meta ?? null,
        createdAt: event.createdAt,
      });
      return;
    }

    if (event.type === "completeItems") {
      await this.completeItems({
        phase: event.phase,
        count: Math.max(0, event.count ?? 1),
        message: event.message,
        meta: event.meta ?? undefined,
        workerId: event.workerId,
      });
      return;
    }

    if (event.type === "failItems") {
      await this.failItems({
        phase: event.phase,
        count: Math.max(0, event.count ?? 1),
        message: event.message,
        meta: event.meta ?? undefined,
        workerId: event.workerId,
      });
      return;
    }

    if (event.type === "finishRun") {
      await this.finishRun();
      if (event.message) {
        await this.appendLog("info", "finalize", event.message, { meta: event.meta ?? null, createdAt: event.createdAt });
      }
      return;
    }

    await this.failRun({ message: event.message, meta: event.meta ?? undefined });
  }

  private incrementPhase(phaseId: string, patch: Partial<Record<"totalWorkers" | "runningWorkers" | "totalTask" | "runningTask" | "finishedTask" | "failedTask" | "skippedTask", number>>) {
    const phase = this.ensurePhase(phaseId);
    phase.totalWorkers = clamp(phase.totalWorkers + (patch.totalWorkers ?? 0));
    phase.runningWorkers = clamp(phase.runningWorkers + (patch.runningWorkers ?? 0));
    phase.totalTask = Math.max(phase.totalTask + (patch.totalTask ?? 0), phase.finishedTask + (patch.finishedTask ?? 0) + phase.failedTask + (patch.failedTask ?? 0));
    phase.runningTask = clamp(phase.runningTask + (patch.runningTask ?? 0));
    phase.finishedTask = clamp(phase.finishedTask + (patch.finishedTask ?? 0));
    phase.failedTask = clamp(phase.failedTask + (patch.failedTask ?? 0));
    phase.skippedTask = clamp(phase.skippedTask + (patch.skippedTask ?? 0));
    this.phaseStore.set(phaseId, phase);
  }

  private ensurePhase(phaseId: string) {
    const phase = this.phaseStore.get(phaseId);
    if (phase) return phase;
    const created: SyncPhaseSnapshot = {
      phaseId,
      phaseName: phaseLabel(phaseId),
      taskName: phaseTaskName(phaseId),
      totalWorkers: 0,
      runningWorkers: 0,
      totalTask: 0,
      runningTask: 0,
      finishedTask: 0,
      failedTask: 0,
      skippedTask: 0,
    };
    this.phaseStore.set(phaseId, created);
    return created;
  }

  private async appendLog(
    level: "info" | "warn" | "error",
    phaseId: string,
    message: string,
    options: { workerId?: string | null; meta?: JsonRecord | null; createdAt?: number } = {},
  ) {
    const phase = this.ensurePhase(phaseId);
    const seq = this.nextLogSeq++;
    await this.ctx.storage.put("nextLogSeq", this.nextLogSeq);
    await this.db.insert(syncStateLogs).values({
      seq,
      runId: this.runId(),
      phaseId,
      phaseName: phase.phaseName,
      workerId: options.workerId ?? null,
      level,
      message: formatLogMessage(phase, message),
      progressCurrent: phase.finishedTask,
      progressTotal: phase.totalTask,
      metaJson: options.meta ?? null,
      createdAt: options.createdAt ?? nowUnix(),
      persisted: 0,
    });
  }

  private async persistRuntimeState() {
    await this.ctx.storage.put({
      status: this.status,
      activePhaseId: this.activePhaseId,
      phases: Array.from(this.phaseStore.values()),
      workers: Array.from(this.workers.values()),
      nextLogSeq: this.nextLogSeq,
    });
  }

  private toLogEntry(row: typeof syncStateLogs.$inferSelect): SyncRunLogEntry {
    return {
      id: row.seq,
      runId: row.runId,
      seq: row.seq,
      level: row.level,
      phase: row.phaseName,
      phaseId: row.phaseId,
      phaseName: row.phaseName,
      workerId: row.workerId,
      message: row.message,
      progressCurrent: row.progressCurrent,
      progressTotal: row.progressTotal,
      metaJson: row.metaJson,
      createdAt: row.createdAt,
    };
  }

  private runId() {
    const name = this.ctx.id.name ?? "";
    const [, value] = name.split(":");
    return Number(value) || 0;
  }
}

export function getSyncRunState(env: SyncRunStateEnv, runId: number) {
  return env.WEREAD_SYNC_STATE.getByName(`sync-run:${runId}`);
}

export async function getSyncRunLiveSnapshot(env: SyncRunStateEnv, runId: number) {
  const state = getSyncRunState(env, runId) as unknown as { snapshot(): Promise<SyncRunLiveSnapshot> };
  return state.snapshot();
}

function phaseLabel(phaseId: string) {
  if (phaseId === "bootstrap") return "初始化";
  if (phaseId === "shelf") return "书架";
  if (phaseId === "notebooks") return "笔记本";
  if (phaseId === "reading_periods") return "历史阅读周期";
  if (phaseId === "reading_years") return "年度统计";
  if (phaseId === "reading_days") return "每日阅读";
  if (phaseId === "book_details") return "书籍详情";
  if (phaseId === "highlights_reviews") return "划线和想法";
  if (phaseId === "reading_week") return "当前周阅读";
  if (phaseId === "commit") return "提交";
  if (phaseId === "finalize") return "完成";
  if (phaseId === "failed") return "失败";
  return phaseId;
}

function phaseTaskName(phaseId: string) {
  if (phaseId === "reading_periods") return "weekly";
  if (phaseId === "reading_years") return "year";
  if (phaseId === "reading_days") return "day";
  if (phaseId === "book_details") return "book";
  if (phaseId === "highlights_reviews") return "notebook";
  if (phaseId === "notebooks") return "notebook";
  if (phaseId === "shelf") return "shelf";
  return "task";
}

function formatLogMessage(phase: SyncPhaseSnapshot, message: string) {
  if (phase.totalTask > 0 && phase.finishedTask > 0) {
    return `${message} · ${phase.finishedTask}/${phase.totalTask}`;
  }
  return message;
}

function clamp(value: number) {
  return Math.max(0, value);
}
