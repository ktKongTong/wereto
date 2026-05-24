import {and, countDistinct, desc, eq, gt, gte, inArray, isNotNull, max, min, or, sql, sum} from "drizzle-orm";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import {
  books,
  bookProgress,
  readBooks,
  readingDays,
  readingPeriodBooks,
  readingPeriods,
  readingTopBooks,
  readingYears,
  syncSnapshotReadingDays,
  syncSnapshotReadingPeriodBooks,
  syncSnapshotReadingPeriods,
  syncSnapshotReadingTopBooks,
  syncSnapshotReadingYears,
} from "../schema.ts";
import { bulkInsert, bulkInsertStatements, bulkUpsert, deleteWhereInStatements, executeStatementBatches } from "../utils/d1-bulk-writer.ts";

type SnapshotInput<T> = Omit<T, "id" | "runId" | "createdAt">;

export type ReadingPeriodSnapshotInput = SnapshotInput<typeof syncSnapshotReadingPeriods.$inferInsert>;
export type ReadingPeriodBookSnapshotInput = SnapshotInput<typeof syncSnapshotReadingPeriodBooks.$inferInsert>;
export type ReadingYearSnapshotInput = SnapshotInput<typeof syncSnapshotReadingYears.$inferInsert>;
export type ReadingTopBookSnapshotInput = SnapshotInput<typeof syncSnapshotReadingTopBooks.$inferInsert>;
export type ReadingDaySnapshotInput = SnapshotInput<typeof syncSnapshotReadingDays.$inferInsert>;

export class ReadingRepo {
  constructor(private readonly db: DB) {}

  async clearSnapshots(runId: number) {
    await executeStatementBatches(this.db, [
      this.db.delete(syncSnapshotReadingPeriods).where(eq(syncSnapshotReadingPeriods.runId, runId)),
      this.db.delete(syncSnapshotReadingPeriodBooks).where(eq(syncSnapshotReadingPeriodBooks.runId, runId)),
      this.db.delete(syncSnapshotReadingYears).where(eq(syncSnapshotReadingYears.runId, runId)),
      this.db.delete(syncSnapshotReadingTopBooks).where(eq(syncSnapshotReadingTopBooks.runId, runId)),
      this.db.delete(syncSnapshotReadingDays).where(eq(syncSnapshotReadingDays.runId, runId)),
    ]);
  }

  async commitSnapshots(runId: number, bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
    const [periodSnapshots, periodBookSnapshots, yearSnapshots, topBookSnapshots, daySnapshots] = await this.listCommitSnapshots(runId);
    await this.commitPeriods(periodSnapshots, periodBookSnapshots, bookIdMap, albumIdMap, now);
    await this.commitYears(yearSnapshots, topBookSnapshots, bookIdMap, albumIdMap, now);
    await this.commitDays(daySnapshots, now);
    await this.rebuildReadBooksFromWeeklyPeriods(now);
  }

  async listCommitSnapshots(runId: number) {
    return this.db.batch([
      this.db.select().from(syncSnapshotReadingPeriods).where(eq(syncSnapshotReadingPeriods.runId, runId)),
      this.db.select().from(syncSnapshotReadingPeriodBooks).where(eq(syncSnapshotReadingPeriodBooks.runId, runId)),
      this.db.select().from(syncSnapshotReadingYears).where(eq(syncSnapshotReadingYears.runId, runId)),
      this.db.select().from(syncSnapshotReadingTopBooks).where(eq(syncSnapshotReadingTopBooks.runId, runId)),
      this.db.select().from(syncSnapshotReadingDays).where(eq(syncSnapshotReadingDays.runId, runId)),
    ]);
  }

  async stageReadingPeriod(runId: number, row: ReadingPeriodSnapshotInput) {
    await this.stageReadingPeriods(runId, [row]);
  }

  async stageReadingPeriods(runId: number, rows: ReadingPeriodSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReadingPeriods, [syncSnapshotReadingPeriods.runId, syncSnapshotReadingPeriods.periodType, syncSnapshotReadingPeriods.periodStart], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageReadingPeriodBooks(runId: number, rows: ReadingPeriodBookSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReadingPeriodBooks, [syncSnapshotReadingPeriodBooks.runId, syncSnapshotReadingPeriodBooks.periodKey, syncSnapshotReadingPeriodBooks.rank], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageReadingYears(runId: number, rows: ReadingYearSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReadingYears, [syncSnapshotReadingYears.runId, syncSnapshotReadingYears.year], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageReadingTopBooks(runId: number, rows: ReadingTopBookSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReadingTopBooks, [syncSnapshotReadingTopBooks.runId, syncSnapshotReadingTopBooks.year, syncSnapshotReadingTopBooks.rank], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageReadingDays(runId: number, rows: ReadingDaySnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReadingDays, [syncSnapshotReadingDays.runId, syncSnapshotReadingDays.year, syncSnapshotReadingDays.day], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async commitPeriods(
    periodRows: Array<typeof syncSnapshotReadingPeriods.$inferSelect>,
    bookRows: Array<typeof syncSnapshotReadingPeriodBooks.$inferSelect>,
    bookIdMap: Map<string, number>,
    albumIdMap: Map<string, number>,
    now: number,
  ) {
    const periodValues = periodRows.map(({ id: _id, runId: _runId, createdAt: _createdAt, ...row }) => ({
      ...row,
      rawJson: row.rawJson ?? null,
      updatedAt: now,
    }));
    const committedPeriodKeys = new Set(periodValues.map((item) => `${item.periodType}:${item.periodStart}`));

    await this.upsertReadingPeriods(periodValues);
    const periodIdMap = await this.getReadingPeriodIdMap(periodValues);
    const committedPeriodIds = [...periodIdMap.values()];
    const values = bookRows.flatMap((row) => {
      const periodId = periodIdMap.get(row.periodKey);
      if (!committedPeriodKeys.has(row.periodKey) || !periodId) return [];
      return [{
        ...this.readingItemFromSnapshot(row, bookIdMap, albumIdMap),
        periodId,
        rawJson: row.rawJson ?? null,
        updatedAt: now,
      }];
    });
    await this.replaceReadingPeriodBooks(committedPeriodIds, values);
  }

  async commitYears(
    yearRows: Array<typeof syncSnapshotReadingYears.$inferSelect>,
    topRows: Array<typeof syncSnapshotReadingTopBooks.$inferSelect>,
    bookIdMap: Map<string, number>,
    albumIdMap: Map<string, number>,
    now: number,
  ) {
    const years = yearRows.map((row) => row.year);
    await this.upsertReadingYears(yearRows.map(({ id: _id, runId: _runId, createdAt: _createdAt, ...row }) => ({
      ...row,
      rawJson: row.rawJson ?? null,
      updatedAt: now,
    })));
    await this.replaceReadingTopBooks(years, topRows.map((row) => ({
      year: row.year,
      ...this.readingItemFromSnapshot(row, bookIdMap, albumIdMap),
      updatedAt: now,
    })));
  }

  async commitDays(rows: Array<typeof syncSnapshotReadingDays.$inferSelect>, now: number) {
    await this.upsertReadingDays(rows.map(({ id: _id, runId: _runId, createdAt: _createdAt, ...row }) => ({
      ...row,
      updatedAt: now,
    })));
  }

  private readingItemFromSnapshot(
    row: typeof syncSnapshotReadingPeriodBooks.$inferSelect | typeof syncSnapshotReadingTopBooks.$inferSelect,
    bookIdMap: Map<string, number>,
    albumIdMap: Map<string, number>,
  ) {
    return {
      bookId: row.wereadBookId ? bookIdMap.get(row.wereadBookId) ?? null : null,
      albumId: row.wereadAlbumId ? albumIdMap.get(row.wereadAlbumId) ?? null : null,
      rank: row.rank,
      readTime: row.readTime,
      recordReadingTime: row.recordReadingTime,
      tagsJson: row.tagsJson ?? [],
      title: row.title,
      author: row.author,
      cover: row.cover,
    };
  }

  async upsertReadingPeriods(values: Array<typeof readingPeriods.$inferInsert>) {
    await bulkUpsert(this.db, readingPeriods, [readingPeriods.periodType, readingPeriods.periodStart], values);
  }

  async getReadingPeriodIdMap(values: Array<Pick<typeof readingPeriods.$inferInsert, "periodType" | "periodStart">>) {
    if (values.length === 0) return new Map<string, number>();
    const map = new Map<string, number>();
    const expectedKeys = new Set(values.map((value) => `${value.periodType}:${value.periodStart}`));
    const periodTypes = [...new Set(values.map((value) => value.periodType))];
    for (const row of await this.db.select().from(readingPeriods).where(inArray(readingPeriods.periodType, periodTypes))) {
      const key = `${row.periodType}:${row.periodStart}`;
      if (expectedKeys.has(key)) map.set(key, row.id);
    }
    return map;
  }

  async replaceReadingPeriodBooks(periodIds: number[], values: Array<typeof readingPeriodBooks.$inferInsert>) {
    await executeStatementBatches(this.db, [
      ...deleteWhereInStatements(this.db, readingPeriodBooks, readingPeriodBooks.periodId, periodIds),
      ...bulkInsertStatements(this.db, readingPeriodBooks, values),
    ]);
  }

  async upsertReadingYears(values: Array<typeof readingYears.$inferInsert>) {
    await bulkUpsert(this.db, readingYears, readingYears.year, values);
  }

  async replaceReadingTopBooks(years: number[], values: Array<typeof readingTopBooks.$inferInsert>) {
    await executeStatementBatches(this.db, [
      ...deleteWhereInStatements(this.db, readingTopBooks, readingTopBooks.year, years),
      ...bulkInsertStatements(this.db, readingTopBooks, values),
    ]);
  }

  async upsertReadingDays(values: Array<typeof readingDays.$inferInsert>) {
    await bulkUpsert(this.db, readingDays, [readingDays.year, readingDays.day], values);
  }

  async rebuildReadBooksFromWeeklyPeriods(now: number) {
    const rows = await this.db
      .select({
        bookId: readingPeriodBooks.bookId,
        firstSeenPeriodStart: min(readingPeriods.periodStart),
        lastSeenPeriodStart: max(readingPeriods.periodStart),
        totalReadTime: sum(readingPeriodBooks.readTime),
        seenPeriods: countDistinct(readingPeriodBooks.periodId),
      })
      .from(readingPeriodBooks)
      .innerJoin(readingPeriods, eq(readingPeriods.id, readingPeriodBooks.periodId))
      .where(and(eq(readingPeriods.periodType, "weekly"), isNotNull(readingPeriodBooks.bookId)))
      .groupBy(readingPeriodBooks.bookId);

    const values = rows.flatMap((row) => {
      if (!row.bookId || !row.firstSeenPeriodStart || !row.lastSeenPeriodStart) return [];
      return [{
        bookId: row.bookId,
        firstSeenPeriodStart: row.firstSeenPeriodStart,
        lastSeenPeriodStart: row.lastSeenPeriodStart,
        totalReadTime: Number(row.totalReadTime ?? 0),
        seenPeriods: row.seenPeriods,
        source: "weekly_read_longest",
        updatedAt: now,
      }];
    });
    await executeStatementBatches(this.db, [
      this.db.delete(readBooks),
      ...bulkInsertStatements(this.db, readBooks, values),
    ]);
  }

  async listReadingYears() {
    return this.db.select().from(readingYears).orderBy(readingYears.year);
  }

  async listReadingDaysByYears(years: number[]) {
    if (years.length === 0) return [];
    return this.db.select().from(readingDays).where(inArray(readingDays.year, years)).orderBy(readingDays.year, readingDays.day);
  }

  async listReadingTopBooksByYears(years: number[]) {
    if (years.length === 0) return [];
    return this.db.select().from(readingTopBooks).where(inArray(readingTopBooks.year, years)).orderBy(readingTopBooks.year, readingTopBooks.rank);
  }

  async listReadBooks() {
    return this.db.select().from(readBooks).orderBy(desc(readBooks.totalReadTime), desc(readBooks.lastSeenPeriodStart));
  }

  async listRecentReadBooks(limit: number) {
    return this.db
      .select({
        wereadBookId: books.wereadBookId,
        title: books.title,
        author: books.author,
        cover: books.cover,
        category: books.category,
        progress: bookProgress.progress,
        recordReadingTime: bookProgress.recordReadingTime,
        finishTime: bookProgress.finishTime,
        isStartReading: bookProgress.isStartReading,
        lastReadAt: bookProgress.sourceUpdateTime,
      })
      .from(bookProgress)
      .innerJoin(books, eq(books.id, bookProgress.bookId))
      .where(
        or(
          eq(bookProgress.isStartReading, 1),
          gt(bookProgress.recordReadingTime, 0),
          gt(bookProgress.progress, 0),
        )
      )
      .orderBy(desc(bookProgress.sourceUpdateTime), desc(bookProgress.updatedAt))
      .limit(limit);
  }
}
