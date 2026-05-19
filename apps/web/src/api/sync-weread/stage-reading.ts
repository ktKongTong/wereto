import type { ReadDataDetailResponse, ReadDataLongestItem, WereadClient } from "@repo/weread-api";

import type { AppDb } from "../db/client.ts";
import { SyncRunLogger } from "../sync-logger.ts";
import { updateRun } from "./state.ts";
import { stageAlbum, stageBook } from "./stage-books.ts";
import { stageSnapshot } from "./snapshots.ts";
import type { AlbumSnapshot, BookSnapshot, ReadDataAlbum, ReadDataBook } from "./types.ts";
import { ONE_DAY_SECONDS, estimateReadingPeriodCount, getPeriodEndKey, getPeriodStartKey, nowUnix, toJson } from "./utils.ts";

export async function stageReadingPeriods(
  db: AppDb,
  client: WereadClient,
  overall: ReadDataDetailResponse,
  runId: number,
  stagedBookIds: Set<string>,
  logger: SyncRunLogger,
) {
  const now = nowUnix();
  const startTime = overall.registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const seenWeeks = new Set<number>();
  const progressTotal = estimateReadingPeriodCount(overall.registTime, now);
  let progressCurrent = 0;

  for (let time = now; time >= startTime; time -= 7 * ONE_DAY_SECONDS) {
    const weekly = await client.getReadData({ mode: "weekly", baseTime: time });
    if (!weekly.baseTime || seenWeeks.has(weekly.baseTime)) continue;

    seenWeeks.add(weekly.baseTime);
    await stageReadingPeriod(db, runId, "weekly", weekly, stagedBookIds);
    progressCurrent += 1;
    if (progressCurrent % 50 === 0) {
      await updateRun(db, runId, { progressCurrent, progressTotal, updatedAt: nowUnix() });
      await logger.info("reading_periods", `weekly snapshot 已写入 ${progressCurrent}/${progressTotal}`, { progressCurrent, progressTotal });
    }
  }

  await stageReadingPeriod(db, runId, "overall", overall, stagedBookIds);
  await updateRun(db, runId, { progressCurrent: progressTotal, progressTotal, updatedAt: nowUnix() });
  await logger.info("reading_periods", "weekly/overall snapshot 写入完成", { progressCurrent: progressTotal, progressTotal });
}

export async function stageReadingPeriod(
  db: AppDb,
  runId: number,
  periodType: string,
  payload: ReadDataDetailResponse,
  stagedBookIds: Set<string>,
) {
  const baseTime = payload.baseTime ?? 0;
  const periodStart = getPeriodStartKey(periodType, baseTime);
  const periodEnd = getPeriodEndKey(periodType, baseTime);
  const periodKey = `${periodType}:${periodStart}`;

  await stageSnapshot(db, runId, "reading_periods", periodKey, {
    periodType,
    periodStart,
    periodEnd,
    baseTime,
    totalReadTime: payload.totalReadTime ?? 0,
    readDays: payload.readDays ?? 0,
    dayAverageReadTime: payload.dayAverageReadTime ?? 0,
    compare: payload.compare !== undefined ? Math.round(payload.compare * 10000) : null,
    readTimesJson: payload.readTimes ? toJson(payload.readTimes) : null,
    readStatJson: payload.readStat ? toJson(payload.readStat) : null,
    rawJson: toJson(payload),
  });

  for (const [index, item] of (payload.readLongest ?? []).entries()) {
    await stageReadingPeriodBook(db, runId, periodKey, index + 1, item, stagedBookIds);
  }
}

async function stageReadingPeriodBook(db: AppDb, runId: number, periodKey: string, rank: number, item: ReadDataLongestItem, stagedBookIds: Set<string>) {
  if (item.book?.bookId) await stageBook(db, runId, bookFromReadData(item.book), stagedBookIds);
  if (item.albumInfo?.albumId) await stageAlbum(db, runId, albumFromReadData(item.albumInfo));

  await stageSnapshot(db, runId, "reading_period_books", `${periodKey}:${rank}`, {
    periodKey,
    rank,
    wereadBookId: item.book?.bookId ?? null,
    wereadAlbumId: item.albumInfo?.albumId ?? null,
    readTime: item.readTime ?? 0,
    recordReadingTime: item.recordReadingTime ?? 0,
    tagsJson: toJson(item.tags ?? []),
    titleSnapshot: item.book?.title ?? item.albumInfo?.name ?? "未知条目",
    authorSnapshot: item.book?.author ?? item.albumInfo?.authorName,
    coverSnapshot: item.book?.cover ?? item.albumInfo?.cover,
    rawJson: toJson(item),
  });
}

export function bookFromReadData(book: ReadDataBook): BookSnapshot {
  const raw = book as Record<string, unknown>;
  return { wereadBookId: book.bookId ?? "", title: book.title ?? "未知书籍", author: book.author, cover: book.cover, intro: typeof raw.intro === "string" ? raw.intro : null, rawJson: toJson(book) };
}

export function albumFromReadData(album: ReadDataAlbum): AlbumSnapshot {
  return { wereadAlbumId: album.albumId ?? "", name: album.name ?? "未知专辑", authorName: album.authorName, cover: album.cover, rawJson: toJson(album) };
}
