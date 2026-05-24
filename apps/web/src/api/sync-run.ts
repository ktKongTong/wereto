import {
  getSyncRunLiveSnapshot,
  type SyncPhaseSnapshot,
  type SyncRunLiveSnapshot,
  type SyncRunLogEntry
} from "@/api/do/sync-run-state.ts";
import type {Context} from "hono";

export const getSyncRun = async (c:Context) => {
  const runId = Number(c.req.param("id"));
  const run = await c.get("repos").runs.getWithLogs(runId);
  if (!run) {
    return c.json({ error: "Not found" }, 404);
  }
  if (run.status === "queued" || run.status === "running") {
    let live: SyncRunLiveSnapshot | null = null;
    try {
      live = await getSyncRunLiveSnapshot(c.env, runId);
    } catch {
      live = null;
    }
    if (live) {
      const logs = mergeSyncLogs(run.logs, live.logs);
      const status = live.status === "queued" ? run.status : live.status;
      const phase = status === "success" ? "" : live.phase === "queued" ? run.phase : live.phase;
      const phaseSteps = normalizePhaseCompletion(
        mergeSyncPhaseSteps(buildPhaseStepsFromLogs(logs), live.phaseSteps),
        logs,
        status,
        phase,
      );
      const phases = buildPhaseRecord(phaseSteps);
      return c.json({
        ...run,
        status,
        phase,
        progressCurrent: phaseSteps.find((step) => step.phaseId === live.phase)?.finishedTask ?? live.progressCurrent,
        progressTotal: phaseSteps.find((step) => step.phaseId === live.phase)?.totalTask ?? live.progressTotal,
        logs,
        phases,
        phaseSteps,
        phaseLogs: groupSyncLogsByPhase(phaseSteps, logs),
      });
    }
  }
  const logs = normalizeSyncLogs(run.logs);
  const phase = run.status === "success" ? "" : run.phase;
  const phaseSteps = normalizePhaseCompletion(buildPhaseStepsFromLogs(logs), logs, run.status, phase);
  return c.json({
    ...run,
    phase,
    logs,
    phases: buildPhaseRecord(phaseSteps),
    phaseSteps,
    phaseLogs: groupSyncLogsByPhase(phaseSteps, logs),
  });
}


function normalizeSyncLogs(logs: unknown[]): SyncRunLogEntry[] {
  return logs.map((log, index) => {
    const row = log as {
      id: number;
      runId: number;
      seq?: number | null;
      level: "info" | "warn" | "error";
      phase: string;
      phaseId?: string | null;
      phaseName?: string | null;
      workerId?: string | null;
      message: string;
      progressCurrent?: number | null;
      progressTotal?: number | null;
      metaJson?: Record<string, unknown> | null;
      createdAt: number;
    };
    return {
      id: row.id,
      runId: row.runId,
      seq: row.seq ?? row.id ?? index,
      level: row.level,
      phase: row.phaseName ?? row.phase,
      phaseId: row.phaseId ?? row.phase,
      phaseName: row.phaseName ?? row.phase,
      workerId: row.workerId ?? null,
      message: row.message,
      progressCurrent: row.progressCurrent ?? null,
      progressTotal: row.progressTotal ?? null,
      metaJson: row.metaJson ?? null,
      createdAt: row.createdAt,
    };
  });
}

function mergeSyncLogs(persisted: unknown[], live: SyncRunLogEntry[]) {
  const map = new Map<string, SyncRunLogEntry>();
  for (const log of [...normalizeSyncLogs(persisted), ...live]) {
    map.set(log.seq ? `seq:${log.seq}` : `log:${log.id}:${log.phaseId}:${log.message}`, log);
  }
  return Array.from(map.values()).sort((a, b) => (a.seq - b.seq) || (a.createdAt - b.createdAt));
}

function buildPhaseStepsFromLogs(logs: SyncRunLogEntry[]): SyncPhaseSnapshot[] {
  const map = new Map<string, SyncPhaseSnapshot>();
  for (const log of logs) {
    const phaseId = log.phaseId || log.phase;
    const current = log.progressCurrent ?? 0;
    const total = log.progressTotal ?? 0;
    const existing = map.get(phaseId);
    map.set(phaseId, {
      phaseId,
      phaseName: existing?.phaseName ?? log.phaseName ?? log.phase,
      taskName: existing?.taskName ?? "task",
      totalWorkers: existing?.totalWorkers ?? 0,
      runningWorkers: existing?.runningWorkers ?? 0,
      totalTask: Math.max(existing?.totalTask ?? 0, total),
      runningTask: existing?.runningTask ?? 0,
      finishedTask: Math.max(existing?.finishedTask ?? 0, current),
      failedTask: (existing?.failedTask ?? 0) + (log.level === "error" ? 1 : 0),
      skippedTask: existing?.skippedTask ?? 0,
    });
  }
  return Array.from(map.values());
}

function mergeSyncPhaseSteps(persisted: SyncPhaseSnapshot[], live: SyncPhaseSnapshot[]) {
  const map = new Map<string, SyncPhaseSnapshot>();
  for (const phase of persisted) map.set(phase.phaseId, phase);
  for (const phase of live) {
    const existing = map.get(phase.phaseId);
    map.set(phase.phaseId, {
      ...phase,
      failedTask: Math.max(existing?.failedTask ?? 0, phase.failedTask),
      skippedTask: Math.max(existing?.skippedTask ?? 0, phase.skippedTask),
      totalTask: Math.max(existing?.totalTask ?? 0, phase.totalTask),
      finishedTask: Math.max(existing?.finishedTask ?? 0, phase.finishedTask),
      totalWorkers: Math.max(existing?.totalWorkers ?? 0, phase.totalWorkers),
      runningWorkers: phase.runningWorkers,
      runningTask: phase.runningTask,
    });
  }
  return Array.from(map.values());
}

function normalizePhaseCompletion(
  phaseSteps: SyncPhaseSnapshot[],
  logs: SyncRunLogEntry[],
  status: string,
  activePhaseId: string,
) {
  const loggedPhaseIds = new Set(logs.map((log) => log.phaseId || log.phase));
  return phaseSteps.map((phase) => {
    if (phase.totalTask > 0 || phase.failedTask > 0 || !loggedPhaseIds.has(phase.phaseId)) {
      return phase;
    }

    const completeMarkerPhase = status === "success" || phase.phaseId !== activePhaseId;
    if (!completeMarkerPhase) return phase;

    return {
      ...phase,
      totalTask: 1,
      finishedTask: 1,
    };
  });
}

function buildPhaseRecord(phaseSteps: SyncPhaseSnapshot[]) {
  return Object.fromEntries(phaseSteps.map((phase) => [
    phase.phaseId,
    {
      total: phase.totalTask,
      completed: phase.finishedTask,
      failed: phase.failedTask,
      skipped: phase.skippedTask,
    },
  ]));
}

function groupSyncLogsByPhase(phaseSteps: SyncPhaseSnapshot[], logs: SyncRunLogEntry[]) {
  const phases = phaseSteps.length > 0 ? phaseSteps : buildPhaseStepsFromLogs(logs);
  return phases.map((phase) => ({
    ...phase,
    logs: logs.filter((log) => (log.phaseId || log.phase) === phase.phaseId),
  }));
}
