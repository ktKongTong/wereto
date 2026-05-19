import { highlights, reviews } from "../db/schema.ts";
import { bulkInsert, deleteWhereIn } from "../db/utils/d1-bulk-writer.ts";
import { parseSnapshot } from "./snapshots.ts";
import type { DbLike, SnapshotRow } from "./types.ts";

export async function commitNotebookContent(
  db: DbLike,
  highlightRows: SnapshotRow[],
  reviewRows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  now: number,
) {
  const touchedBookIds = findTouchedBookIds([...highlightRows, ...reviewRows], bookIdMap);
  await deleteWhereIn(db, highlights, highlights.bookId, touchedBookIds);
  await deleteWhereIn(db, reviews, reviews.bookId, touchedBookIds);

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

  await bulkInsert(db, highlights, highlightValues);

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

  await bulkInsert(db, reviews, reviewValues);
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
