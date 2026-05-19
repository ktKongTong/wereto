import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client.ts";
import { syncCursors, syncRuns } from "../db/schema.ts";

export const FULL_SYNC_COMPLETED_CURSOR = "weread.sync.fullCompletedAt";

export async function createRun(db: AppDb, startedAt: number) {
  const [row] = await db
    .insert(syncRuns)
    .values({
      taskType: "weread_sync",
      source: "weread",
      status: "queued",
      phase: "queued",
      requestedAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      progressCurrent: 0,
      progressTotal: 0,
      statsJson: "{}",
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create sync run");
  }

  return row.id;
}

export async function updateRun(db: AppDb, runId: number, patch: Partial<typeof syncRuns.$inferInsert>) {
  await db.update(syncRuns).set(patch).where(eq(syncRuns.id, runId));
}

export async function getCursor(db: AppDb, key: string) {
  const [row] = await db.select().from(syncCursors).where(eq(syncCursors.key, key)).limit(1);
  return row?.value ?? null;
}
