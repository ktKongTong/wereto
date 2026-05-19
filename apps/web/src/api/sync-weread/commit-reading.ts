import { and, eq } from "drizzle-orm";

import {
  readBooks,
  readingDays,
  readingPeriodBooks,
  readingPeriods,
  readingTopBooks,
  readingYears,
  syncCursors,
} from "../db/schema.ts";
import { bulkInsert, bulkUpsert, deleteWhereIn } from "../db/utils/d1-bulk-writer.ts";
import { parseSnapshot } from "./snapshots.ts";
import type { DbLike, SnapshotRow } from "./types.ts";

export async function commitReadingPeriods(db: DbLike, periodRows: SnapshotRow[], bookRows: SnapshotRow[], bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  const periodValues = periodRows.map((row) => mapPeriod(row, now));
  const committedPeriodKeys = new Set(periodValues.map((item) => `${item.periodType}:${item.periodStart}`));

  await bulkUpsert(db, readingPeriods, [readingPeriods.periodType, readingPeriods.periodStart], periodValues, ["period_end", "base_time", "total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "read_times_json", "read_stat_json", "raw_json", "updated_at"]);

  const periodIdMap = await loadPeriodIdMap(db, periodValues);
  const committedPeriodIds = [...periodIdMap.values()];
  await deleteWhereIn(db, readingPeriodBooks, readingPeriodBooks.periodId, committedPeriodIds);

  const values = bookRows.flatMap((row) => mapPeriodBook(row, committedPeriodKeys, periodIdMap, bookIdMap, albumIdMap, now));
  await bulkInsert(db, readingPeriodBooks, values);
}

export async function commitReadingYears(db: DbLike, yearRows: SnapshotRow[], topRows: SnapshotRow[], bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  const years = yearRows.map((row) => parseSnapshot<{ year: number }>(row).year);
  const yearValues = yearRows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return {
      year: Number(item.year),
      totalReadTime: Number(item.totalReadTime ?? 0),
      readDays: Number(item.readDays ?? 0),
      dayAverageReadTime: Number(item.dayAverageReadTime ?? 0),
      compare: typeof item.compare === "number" ? item.compare : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    };
  });

  await bulkUpsert(db, readingYears, readingYears.year, yearValues, ["total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "raw_json", "updated_at"]);

  await deleteWhereIn(db, readingTopBooks, readingTopBooks.year, years);
  const topBookValues = topRows.map((row) => mapTopBook(row, bookIdMap, albumIdMap, now));
  await bulkInsert(db, readingTopBooks, topBookValues);
}

export async function commitReadingDays(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return { year: Number(item.year), day: String(item.day), readSeconds: Number(item.readSeconds ?? 0), source: String(item.source ?? "unknown"), updatedAt: now };
  });

  await bulkUpsert(db, readingDays, [readingDays.year, readingDays.day], values, ["read_seconds", "source", "updated_at"]);
}

export async function rebuildReadBooks(db: DbLike, now: number) {
  await db.delete(readBooks);
  const weeklyPeriods = await db.select().from(readingPeriods).where(eq(readingPeriods.periodType, "weekly"));
  const weeklyPeriodMap = new Map(weeklyPeriods.map((period) => [period.id, period]));
  const aggregate = new Map<number, { first: string; last: string; total: number; periods: Set<number> }>();

  for (const row of await db.select().from(readingPeriodBooks)) {
    if (!row.bookId) continue;
    const period = weeklyPeriodMap.get(row.periodId);
    if (!period) continue;
    const current = aggregate.get(row.bookId) ?? { first: period.periodStart, last: period.periodStart, total: 0, periods: new Set<number>() };
    current.first = current.first < period.periodStart ? current.first : period.periodStart;
    current.last = current.last > period.periodStart ? current.last : period.periodStart;
    current.total += row.readTime;
    current.periods.add(period.id);
    aggregate.set(row.bookId, current);
  }

  const values = [...aggregate].map(([bookId, value]) => ({
    bookId,
    firstSeenPeriodStart: value.first,
    lastSeenPeriodStart: value.last,
    totalReadTime: value.total,
    seenPeriods: value.periods.size,
    source: "weekly_read_longest",
    updatedAt: now,
  }));
  await bulkInsert(db, readBooks, values);
}

export async function commitCursors(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<{ key: string; value: string }>(row);
    return { key: item.key, value: item.value, updatedAt: now };
  });
  await bulkUpsert(db, syncCursors, syncCursors.key, values, ["value", "updated_at"]);
}

function mapPeriod(row: SnapshotRow, now: number) {
  const item = parseSnapshot<Record<string, unknown>>(row);
  return {
    periodType: String(item.periodType),
    periodStart: String(item.periodStart),
    periodEnd: typeof item.periodEnd === "string" ? item.periodEnd : null,
    baseTime: Number(item.baseTime ?? 0),
    totalReadTime: Number(item.totalReadTime ?? 0),
    readDays: Number(item.readDays ?? 0),
    dayAverageReadTime: Number(item.dayAverageReadTime ?? 0),
    compare: typeof item.compare === "number" ? item.compare : null,
    readTimesJson: typeof item.readTimesJson === "string" ? item.readTimesJson : null,
    readStatJson: typeof item.readStatJson === "string" ? item.readStatJson : null,
    rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
    updatedAt: now,
  };
}

async function loadPeriodIdMap(db: DbLike, values: ReturnType<typeof mapPeriod>[]) {
  const map = new Map<string, number>();
  for (const value of values) {
    const [period] = await db.select().from(readingPeriods).where(and(eq(readingPeriods.periodType, value.periodType), eq(readingPeriods.periodStart, value.periodStart))).limit(1);
    if (period) map.set(`${value.periodType}:${value.periodStart}`, period.id);
  }
  return map;
}

function mapPeriodBook(row: SnapshotRow, committedKeys: Set<string>, periodIdMap: Map<string, number>, bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  const item = parseSnapshot<Record<string, unknown>>(row);
  const periodKey = String(item.periodKey);
  const periodId = periodIdMap.get(periodKey);
  if (!committedKeys.has(periodKey) || !periodId) return [];
  return [{ ...mapLinkedReadItem(item, bookIdMap, albumIdMap), periodId, rawJson: typeof item.rawJson === "string" ? item.rawJson : null, updatedAt: now }];
}

function mapTopBook(row: SnapshotRow, bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  const item = parseSnapshot<Record<string, unknown>>(row);
  return { year: Number(item.year), ...mapLinkedReadItem(item, bookIdMap, albumIdMap), updatedAt: now };
}

function mapLinkedReadItem(item: Record<string, unknown>, bookIdMap: Map<string, number>, albumIdMap: Map<string, number>) {
  return {
    bookId: typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) ?? null : null,
    albumId: typeof item.wereadAlbumId === "string" ? albumIdMap.get(item.wereadAlbumId) ?? null : null,
    rank: Number(item.rank ?? 0),
    readTime: Number(item.readTime ?? 0),
    recordReadingTime: Number(item.recordReadingTime ?? 0),
    tagsJson: typeof item.tagsJson === "string" ? item.tagsJson : null,
    titleSnapshot: String(item.titleSnapshot ?? "未知条目"),
    authorSnapshot: typeof item.authorSnapshot === "string" ? item.authorSnapshot : null,
    coverSnapshot: typeof item.coverSnapshot === "string" ? item.coverSnapshot : null,
  };
}
