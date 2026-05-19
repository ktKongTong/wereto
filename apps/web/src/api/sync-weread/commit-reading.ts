import { and, eq, inArray, sql } from "drizzle-orm";

import {
  readBooks,
  readingDays,
  readingPeriodBooks,
  readingPeriods,
  readingTopBooks,
  readingYears,
  syncCursors,
} from "../db/schema.ts";
import { parseSnapshot } from "./snapshots.ts";
import type { DbLike, SnapshotRow } from "./types.ts";
import { chunkArray, rowParamLimitedChunks } from "./utils.ts";

export async function commitReadingPeriods(db: DbLike, periodRows: SnapshotRow[], bookRows: SnapshotRow[], bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  const periodValues = periodRows.map((row) => mapPeriod(row, now));
  const committedPeriodKeys = new Set(periodValues.map((item) => `${item.periodType}:${item.periodStart}`));

  for (const chunk of rowParamLimitedChunks(periodValues)) {
    await db.insert(readingPeriods).values(chunk).onConflictDoUpdate({
      target: [readingPeriods.periodType, readingPeriods.periodStart],
      set: excluded(["period_end", "base_time", "total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "read_times_json", "read_stat_json", "raw_json", "updated_at"]),
    });
  }

  const periodIdMap = await loadPeriodIdMap(db, periodValues);
  const committedPeriodIds = [...periodIdMap.values()];
  for (const ids of chunkArray(committedPeriodIds, 100)) {
    await db.delete(readingPeriodBooks).where(inArray(readingPeriodBooks.periodId, ids));
  }

  const values = bookRows.flatMap((row) => mapPeriodBook(row, committedPeriodKeys, periodIdMap, bookIdMap, albumIdMap, now));
  for (const chunk of rowParamLimitedChunks(values)) await db.insert(readingPeriodBooks).values(chunk);
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

  for (const chunk of rowParamLimitedChunks(yearValues)) {
    await db.insert(readingYears).values(chunk).onConflictDoUpdate({
      target: readingYears.year,
      set: excluded(["total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "raw_json", "updated_at"]),
    });
  }

  for (const yearChunk of chunkArray(years, 100)) {
    await db.delete(readingTopBooks).where(inArray(readingTopBooks.year, yearChunk));
  }
  const topBookValues = topRows.map((row) => mapTopBook(row, bookIdMap, albumIdMap, now));
  for (const chunk of rowParamLimitedChunks(topBookValues)) await db.insert(readingTopBooks).values(chunk);
}

export async function commitReadingDays(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return { year: Number(item.year), day: String(item.day), readSeconds: Number(item.readSeconds ?? 0), source: String(item.source ?? "unknown"), updatedAt: now };
  });

  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(readingDays).values(chunk).onConflictDoUpdate({
      target: [readingDays.year, readingDays.day],
      set: excluded(["read_seconds", "source", "updated_at"]),
    });
  }
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
  for (const chunk of rowParamLimitedChunks(values)) await db.insert(readBooks).values(chunk);
}

export async function commitCursors(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<{ key: string; value: string }>(row);
    return { key: item.key, value: item.value, updatedAt: now };
  });
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(syncCursors).values(chunk).onConflictDoUpdate({
      target: syncCursors.key,
      set: excluded(["value", "updated_at"]),
    });
  }
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

function excluded(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [toCamel(column), sql.raw(`excluded.${column}`)]));
}

function toCamel(column: string) {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
