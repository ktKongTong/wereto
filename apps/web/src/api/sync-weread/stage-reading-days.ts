import type { ReadDataDetailResponse, WereadClient } from "@repo/weread-api";

import type { AppDb } from "../db/client.ts";
import { stageReadingDaySnapshots, stageSnapshot } from "./snapshots.ts";
import { albumFromReadData, bookFromReadData } from "./stage-reading.ts";
import { stageAlbum, stageBook } from "./stage-books.ts";
import { ONE_DAY_SECONDS, formatShanghaiDate, nowUnix, toJson } from "./utils.ts";

export async function stageReadingYear(
  db: AppDb,
  runId: number,
  year: number,
  annual: ReadDataDetailResponse,
  stagedBookIds: Set<string>,
) {
  await stageSnapshot(db, runId, "reading_years", String(year), {
    year,
    totalReadTime: annual.totalReadTime ?? 0,
    readDays: annual.readDays ?? 0,
    dayAverageReadTime: annual.dayAverageReadTime ?? 0,
    compare: annual.compare !== undefined ? Math.round(annual.compare * 10000) : null,
    rawJson: toJson(annual),
  });

  for (const [index, top] of (annual.readLongest ?? []).entries()) {
    if (top.book?.bookId) await stageBook(db, runId, bookFromReadData(top.book), stagedBookIds);
    if (top.albumInfo?.albumId) await stageAlbum(db, runId, albumFromReadData(top.albumInfo));
    await stageSnapshot(db, runId, "reading_top_books", `${year}:${index + 1}`, {
      year,
      rank: index + 1,
      wereadBookId: top.book?.bookId ?? null,
      wereadAlbumId: top.albumInfo?.albumId ?? null,
      readTime: top.readTime ?? 0,
      recordReadingTime: top.recordReadingTime ?? 0,
      tagsJson: toJson(top.tags ?? []),
      titleSnapshot: top.book?.title ?? top.albumInfo?.name ?? "未知条目",
      authorSnapshot: top.book?.author ?? top.albumInfo?.authorName,
      coverSnapshot: top.book?.cover ?? top.albumInfo?.cover,
    });
  }
}

export async function stageReadingDaysForYear(db: AppDb, client: WereadClient, runId: number, year: number) {
  const annual = await client.getReadData({ mode: "annually", baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000) });
  if (annual.dailyReadTimes && Object.keys(annual.dailyReadTimes).length > 0) {
    await stageReadingDaySnapshots(db, runId, Object.entries(annual.dailyReadTimes).map(([timestamp, seconds]) => ({
      year,
      day: formatShanghaiDate(Number(timestamp)),
      readSeconds: Number(seconds),
      source: "annual_daily",
    })));
    return;
  }

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const buckets = (await client.getReadData({
      mode: "monthly",
      baseTime: Math.floor(Date.UTC(year, monthIndex, 1) / 1000),
    })).readTimes ?? {};

    await stageReadingDaySnapshots(db, runId, Object.entries(buckets).map(([timestamp, seconds]) => ({
      year,
      day: formatShanghaiDate(Number(timestamp)),
      readSeconds: Number(seconds),
      source: "monthly_rollup",
    })));
  }
}

export async function stageCurrentWeekReadingDays(db: AppDb, runId: number, weekly: ReadDataDetailResponse) {
  const baseTime = weekly.baseTime ?? nowUnix();
  const bucketMap = new Map<string, number>();
  for (const [timestamp, seconds] of Object.entries(weekly.readTimes ?? {})) {
    bucketMap.set(formatShanghaiDate(Number(timestamp)), Number(seconds));
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => formatShanghaiDate(baseTime + index * ONE_DAY_SECONDS));
  await stageReadingDaySnapshots(db, runId, weekDays.map((day) => ({
    year: Number(day.slice(0, 4)),
    day,
    readSeconds: bucketMap.get(day) ?? 0,
    source: "weekly_current",
  })));

  return weekDays.length;
}
