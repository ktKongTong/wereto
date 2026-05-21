import { eq } from "drizzle-orm";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import { syncCursors, syncSnapshotCursors } from "../schema.ts";
import { bulkUpsert, executeStatementBatches, upsertOne } from "../utils/d1-bulk-writer.ts";

export const FULL_SYNC_COMPLETED_CURSOR = "weread.sync.fullCompletedAt";
export const NOTEBOOKS_LAST_SORT_CURSOR = "weread.notebooks.lastSort";
export const READING_LAST_FULL_YEAR_CURSOR = "weread.reading.lastFullYear";

type SnapshotInput<T> = Omit<T, "id" | "runId" | "createdAt">;

export type SyncCursorSnapshotInput = SnapshotInput<typeof syncSnapshotCursors.$inferInsert>;

export class SyncCursorsRepo {
  constructor(private readonly db: DB) {}

  async get(key: string) {
    const [row] = await this.db.select().from(syncCursors).where(eq(syncCursors.key, key)).limit(1);
    return row?.value ?? null;
  }

  async upsertMany(values: Array<typeof syncCursors.$inferInsert>) {
    await bulkUpsert(this.db, syncCursors, syncCursors.key, values);
  }

  async clearSnapshots(runId: number) {
    await executeStatementBatches(this.db, [
      this.db.delete(syncSnapshotCursors).where(eq(syncSnapshotCursors.runId, runId)),
    ]);
  }

  async stageSyncCursor(runId: number, row: SyncCursorSnapshotInput) {
    const createdAt = nowUnix();
    await upsertOne(this.db, syncSnapshotCursors, [syncSnapshotCursors.runId, syncSnapshotCursors.key], { runId, createdAt, ...row });
  }

  async commitSnapshots(runId: number, now: number) {
    await this.commitRows(await this.listSnapshots(runId), now);
  }

  async listSnapshots(runId: number) {
    return this.db.select().from(syncSnapshotCursors).where(eq(syncSnapshotCursors.runId, runId));
  }

  async commitRows(rows: Array<typeof syncSnapshotCursors.$inferSelect>, now: number) {
    await this.upsertMany(rows.map((row) => ({ key: row.key, value: row.value, updatedAt: now })));
  }
}
