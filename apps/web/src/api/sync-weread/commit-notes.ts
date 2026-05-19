import { inArray } from "drizzle-orm";

import { highlights, reviews } from "../db/schema.ts";
import { parseSnapshot } from "./snapshots.ts";
import type { DbLike, SnapshotRow } from "./types.ts";
import { chunkArray, rowParamLimitedChunks } from "./utils.ts";

export async function commitNotebookContent(
  db: DbLike,
  highlightRows: SnapshotRow[],
  reviewRows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  now: number,
) {
  const touchedBookIds = findTouchedBookIds([...highlightRows, ...reviewRows], bookIdMap);
  for (const ids of chunkArray(touchedBookIds, 100)) {
    await db.delete(highlights).where(inArray(highlights.bookId, ids));
    await db.delete(reviews).where(inArray(reviews.bookId, ids));
  }

  const highlightValues = highlightRows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = resolveBookId(item, bookIdMap);
    if (!bookId) return [];
    return [{
      bookId,
      wereadBookmarkId: String(item.wereadBookmarkId),
      chapterUid: typeof item.chapterUid === "number" ? item.chapterUid : null,
      chapterTitle: typeof item.chapterTitle === "string" ? item.chapterTitle : null,
      range: typeof item.range === "string" ? item.range : null,
      markText: String(item.markText ?? ""),
      colorStyle: typeof item.colorStyle === "number" ? item.colorStyle : null,
      createTime: Number(item.createTime ?? 0),
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });

  for (const chunk of rowParamLimitedChunks(highlightValues)) await db.insert(highlights).values(chunk);

  const reviewValues = reviewRows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = resolveBookId(item, bookIdMap);
    if (!bookId) return [];
    return [{
      bookId,
      wereadReviewId: String(item.wereadReviewId),
      chapterUid: typeof item.chapterUid === "number" ? item.chapterUid : null,
      chapterName: typeof item.chapterName === "string" ? item.chapterName : null,
      range: typeof item.range === "string" ? item.range : null,
      abstract: typeof item.abstract === "string" ? item.abstract : null,
      content: String(item.content ?? ""),
      star: typeof item.star === "number" ? item.star : null,
      isFinish: typeof item.isFinish === "number" ? item.isFinish : null,
      reviewType: String(item.reviewType ?? "unknown"),
      createTime: Number(item.createTime ?? 0),
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });

  for (const chunk of rowParamLimitedChunks(reviewValues)) await db.insert(reviews).values(chunk);
}

function findTouchedBookIds(rows: SnapshotRow[], bookIdMap: Map<string, number>) {
  const touchedBookIds = new Set<number>();
  for (const row of rows) {
    const bookId = resolveBookId(parseSnapshot<Record<string, unknown>>(row), bookIdMap);
    if (bookId) touchedBookIds.add(bookId);
  }
  return [...touchedBookIds];
}

function resolveBookId(item: Record<string, unknown>, bookIdMap: Map<string, number>) {
  return typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
}
