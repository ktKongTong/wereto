import { and, count, eq, gte, sum } from "drizzle-orm";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import { syncStageChunks, type JsonRecord } from "../schema.ts";
import { bulkUpsert } from "../utils/d1-bulk-writer.ts";

export type SyncStageChunkInput = {
  runId: number;
  stage: string;
  chunkIndex: number;
  offset: number;
  size: number;
};

export class SyncStageChunksRepo {
  constructor(private readonly db: DB) {}

  async ensureChunks(chunks: SyncStageChunkInput[]) {
    if (chunks.length === 0) return;
    const now = nowUnix();
    await bulkUpsert(
      this.db,
      syncStageChunks,
      [syncStageChunks.runId, syncStageChunks.stage, syncStageChunks.chunkIndex],
      chunks.map((chunk) => ({
        ...chunk,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  async completeChunk(input: { runId: number; stage: string; chunkIndex: number; result?: JsonRecord }) {
    const now = nowUnix();
    const [row] = await this.db
      .update(syncStageChunks)
      .set({
        status: "success",
        resultJson: input.result ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(syncStageChunks.runId, input.runId),
        eq(syncStageChunks.stage, input.stage),
        eq(syncStageChunks.chunkIndex, input.chunkIndex),
      ))
      .returning({ id: syncStageChunks.id, size: syncStageChunks.size });

    return row ?? null;
  }

  async failChunk(input: { runId: number; stage: string; chunkIndex: number; error: string }) {
    const now = nowUnix();
    const [row] = await this.db
      .update(syncStageChunks)
      .set({
        status: "failed",
        resultJson: { error: input.error },
        updatedAt: now,
      })
      .where(and(
        eq(syncStageChunks.runId, input.runId),
        eq(syncStageChunks.stage, input.stage),
        eq(syncStageChunks.chunkIndex, input.chunkIndex),
      ))
      .returning({ id: syncStageChunks.id });

    return row ?? null;
  }

  async getProgress(runId: number, stage: string) {
    const [totalRows, doneRows, doneSizeRows] = await this.db.batch([
      this.db.select({ value: count(), size: sum(syncStageChunks.size) }).from(syncStageChunks).where(and(
        eq(syncStageChunks.runId, runId),
        eq(syncStageChunks.stage, stage),
        gte(syncStageChunks.chunkIndex, 0),
      )),
      this.db.select({ value: count() }).from(syncStageChunks).where(and(
        eq(syncStageChunks.runId, runId),
        eq(syncStageChunks.stage, stage),
        gte(syncStageChunks.chunkIndex, 0),
        eq(syncStageChunks.status, "success"),
      )),
      this.db.select({ size: sum(syncStageChunks.size) }).from(syncStageChunks).where(and(
        eq(syncStageChunks.runId, runId),
        eq(syncStageChunks.stage, stage),
        gte(syncStageChunks.chunkIndex, 0),
        eq(syncStageChunks.status, "success"),
      )),
    ]);

    return {
      total: totalRows[0]?.value ?? 0,
      done: doneRows[0]?.value ?? 0,
      totalItems: Number(totalRows[0]?.size ?? 0),
      doneItems: Number(doneSizeRows[0]?.size ?? 0),
    };
  }

  async claimStageAdvance(runId: number, stage: string) {
    const now = nowUnix();
    const [row] = await this.db
      .insert(syncStageChunks)
      .values({
        runId,
        stage,
        chunkIndex: -1,
        offset: 0,
        size: 0,
        status: "advanced",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: syncStageChunks.id });

    return row ?? null;
  }
}
