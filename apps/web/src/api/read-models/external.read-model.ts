import type { RepoCtx } from "../db/repos/ctx.ts";

const RECENT_LIMIT = 20;

export type ExternalBookItem = {
  type: "book";
  wereadBookId: string | null;
  title: string;
  author: string | null;
  cover: string | null;
  category: string | null;
  progress?: number | null;
  recordReadingTime?: number | null;
  finishTime?: number | null;
  isStartReading?: number | null;
  sourceUpdateTime?: number | null;
  sourceTimestamp?: number | null;
};

export type ExternalAnnotationItem = {
  type: "highlight" | "review";
  bookTitle: string;
  cover: string | null;
  content: string;
  createTime: number;
};

export async function getRecentReadModel(repos: RepoCtx): Promise<ExternalBookItem[]> {
  return (await repos.reading.listRecentReadBooks(RECENT_LIMIT)).map((item) => ({
    type: "book",
    ...item
  }));
}

export async function getRecentAnnotationModel(repos: RepoCtx): Promise<ExternalAnnotationItem[]> {
  return (await repos.notebook.listArchiveTimeline()).slice(0, RECENT_LIMIT).map((item) => ({
    type: item.type,
    bookTitle: item.bookTitle,
    cover: item.cover,
    content: item.content,
    createTime: item.createTime,
  }));
}
