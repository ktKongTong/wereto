import type { RepoCtx } from "../db/repos/ctx.ts";

export interface ArchiveNotebookSummary {
  bookId: string;
  title: string;
  author: string | null;
  cover: string | null;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  totalCount: number;
  sort: number;
}

export interface ArchiveNotebookDetail extends ArchiveNotebookSummary {
  highlights: Array<{
    markText: string;
    createTime: number;
  }>;
  reviews: Array<{
    content: string;
    chapterName?: string | null;
    createTime: number;
  }>;
}

export interface ArchiveTimelineItem {
  type: "review" | "highlight";
  bookTitle: string;
  cover: string;
  content: string;
  createTime: number;
}

export interface ArchiveReadBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  totalReadTime: number;
  seenPeriods: number;
  firstSeenPeriodStart: string;
  lastSeenPeriodStart: string;
  inShelf: boolean;
}

export interface ArchiveShelfBook {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  category?: string;
  readUpdateTime?: number;
  finishReading?: number;
  updateTime?: number;
  isTop?: number;
  secret?: number;
}

export interface ArchiveShelfAlbum {
  albumInfo: {
    albumId: string;
    name: string;
    authorName?: string;
    cover?: string;
    trackCount?: number;
    finishStatus?: string;
    intro?: string;
    updateTime?: number;
  };
  albumInfoExtra?: {
    secret?: number;
    lectureReadUpdateTime?: number;
    isTop?: number;
  };
}

export async function getArchiveReadModel(repos: RepoCtx) {
  const shelfRows = await repos.catalog.listShelfItems();
  const notebookRows = await repos.notebook.listNotebookBooks();
  const readBookRows = await repos.reading.listReadBooks();
  const selectedNotebookRows = await repos.notebook.listNotebookBookSummaries(12);
  const selectedBookIds = selectedNotebookRows.map((row) => row.bookId);
  const [notebookContentPreviews, timelineRows] = await Promise.all([
    repos.notebook.listNotebookContentPreviews(selectedBookIds, 2),
    repos.notebook.listArchiveTimeline(),
  ]);

  const bookIds = Array.from(
    new Set([
      ...shelfRows.map((row) => row.bookId).filter((value): value is number => value !== null),
      ...readBookRows.map((row) => row.bookId),
    ]),
  );
  const bookRows = await repos.catalog.listBooksByIds(bookIds);
  const bookMap = new Map(bookRows.map((row) => [row.id, row]));
  const shelfBookIds = new Set(shelfRows.map((row) => row.bookId).filter((value): value is number => value !== null));
  const highlightsByBookId = groupByBookId(notebookContentPreviews.highlights);
  const reviewsByBookId = groupByBookId(notebookContentPreviews.reviews);

  const notebookDetails: ArchiveNotebookDetail[] = selectedNotebookRows.map((row) => {
    return {
      ...row,
      bookId: row.wereadBookId,
      highlights: (highlightsByBookId.get(row.bookId) ?? [])
        .map((item) => ({
          markText: item.markText,
          createTime: item.createTime,
        })),
      reviews: (reviewsByBookId.get(row.bookId) ?? [])
        .map((item) => ({
          content: item.content,
          chapterName: item.chapterName,
          createTime: item.createTime,
        })),
    };
  });

  const readBookDetails: ArchiveReadBook[] = readBookRows.map((row) => {
    const book = bookMap.get(row.bookId);
    return {
      bookId: book?.wereadBookId ?? String(row.bookId),
      title: book?.title ?? "未知书籍",
      author: book?.author ?? "",
      cover: book?.cover ?? "",
      totalReadTime: row.totalReadTime,
      seenPeriods: row.seenPeriods,
      firstSeenPeriodStart: row.firstSeenPeriodStart,
      lastSeenPeriodStart: row.lastSeenPeriodStart,
      inShelf: shelfBookIds.has(row.bookId),
    };
  });

  const shelfBooks: ArchiveShelfBook[] = shelfRows
    .filter((row) => row.itemType === "book" && row.bookId !== null)
    .map((row) => ({
      bookId: bookMap.get(row.bookId!)?.wereadBookId ?? String(row.bookId),
      title: row.title,
      author: row.author ?? undefined,
      cover: row.cover ?? undefined,
      category: row.category ?? undefined,
      readUpdateTime: row.readUpdateTime ?? undefined,
      finishReading: row.finishReading,
      updateTime: row.sourceUpdateTime ?? undefined,
      isTop: row.isTop,
      secret: row.isSecret,
    }));

  const albumRows = shelfRows.filter((row) => row.itemType === "album" && row.albumId !== null);
  const albumIds = albumRows.map((row) => row.albumId!).filter((value, index, array) => array.indexOf(value) === index);
  const albumEntities = await repos.catalog.listAlbumsByIds(albumIds);
  const albumMap = new Map(albumEntities.map((row) => [row.id, row]));
  const shelfAlbums: ArchiveShelfAlbum[] = albumRows.map((row) => {
    const album = albumMap.get(row.albumId!);
    return {
      albumInfo: {
        albumId: album?.wereadAlbumId ?? String(row.albumId),
        name: row.title,
        authorName: row.author ?? undefined,
        cover: row.cover ?? undefined,
        trackCount: album?.trackCount ?? undefined,
        finishStatus: album?.finishStatus ?? undefined,
        intro: album?.intro ?? undefined,
        updateTime: album?.updatedAt ?? undefined,
      },
      albumInfoExtra: {
        secret: row.isSecret,
        isTop: row.isTop,
        lectureReadUpdateTime: row.readUpdateTime ?? undefined,
      },
    };
  });

  return {
    shelfBooks,
    shelfAlbums,
    mp: null,
    notebookBooks: notebookRows.map((row) => ({ bookId: String(row.bookId) })),
    notebookDetails,
    readBooks: readBookDetails,
    readBooksNotInShelf: readBookDetails.filter((book) => !book.inShelf),
    timeline: timelineRows.map((item) => ({
      type: item.type,
      bookTitle: item.bookTitle,
      cover: item.cover ?? "",
      content: item.content,
      createTime: item.createTime,
    })),
  };
}

function groupByBookId<T extends { bookId: number }>(rows: T[]) {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const items = map.get(row.bookId);
    if (items) {
      items.push(row);
    } else {
      map.set(row.bookId, [row]);
    }
  }
  return map;
}
