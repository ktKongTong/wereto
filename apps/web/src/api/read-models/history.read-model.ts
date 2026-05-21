import { formatDateKey } from "../../lib/format.ts";
import type { RepoCtx } from "../db/repos/ctx.ts";

const ANNUAL_ANNOTATION_PREVIEW_LIMIT = 10;

type HighLightItem = {
  bookTitle: string;
  cover: string | null;
  content: string;
  createTime: number;
}
export interface HistoryYearRecord {
  year: number;
  annual: {
    totalReadTime: number;
    readDays: number;
    dayAverageReadTime: number;
    compare?: number;
    readLongest: Array<{
      readTime: number;
      recordReadingTime: number;
      tags?: string[];
      book?: {
        title?: string;
        author?: string;
        cover?: string;
      };
      albumInfo?: {
        name?: string;
        authorName?: string;
        cover?: string;
      };
    }>;
    readStat: Array<{ stat: string; counts: string }>;
  };
  annotations: {
    notebookBooks: number;
    highlights: number;
    reviews: number;
    recentHighlights: HighLightItem[];
    recentReviews: HighLightItem[];
  };
  cells: Array<{
    key: string;
    label: string;
    month: number;
    weekIndex: number;
    weekDayIndex: number;
    inYear: boolean;
    seconds: number;
  }>;
  maxValue: number;
  contributionDays: number;
}

export async function getHistoryReadModel(repos: RepoCtx) {
  const yearRows = await repos.reading.listReadingYears();
  const years = yearRows.map((row) => row.year);
  const [dayRows, topRows, annotationsByYear] = await Promise.all([
    repos.reading.listReadingDaysByYears(years),
    repos.reading.listReadingTopBooksByYears(years),
    buildAnnualAnnotations(repos, years),
  ]);
  const dayRowsByYear = groupByYear(dayRows);
  const topRowsByYear = groupByYear(topRows);

  const records: HistoryYearRecord[] = yearRows.map((yearRow) => {
    const days = dayRowsByYear.get(yearRow.year) ?? [];
    const cells = buildCalendarCells(yearRow.year, days);
    const tops = topRowsByYear.get(yearRow.year) ?? [];

    return {
      year: yearRow.year,
      annual: {
        totalReadTime: yearRow.totalReadTime,
        readDays: yearRow.readDays,
        dayAverageReadTime: yearRow.dayAverageReadTime,
        compare: yearRow.compare !== null && yearRow.compare !== undefined ? yearRow.compare / 10_000 : undefined,
        readLongest: tops.map((row) => ({
          readTime: row.readTime,
          recordReadingTime: row.recordReadingTime,
          tags: row.tagsJson ?? [],
          book: row.bookId
            ? {
                title: row.title,
                author: row.author ?? undefined,
                cover: row.cover ?? undefined,
              }
            : undefined,
          albumInfo: row.albumId
            ? {
                name: row.title,
                authorName: row.author ?? undefined,
                cover: row.cover ?? undefined,
              }
            : undefined,
        })),
        readStat: [],
      },
      annotations: annotationsByYear.get(yearRow.year) ?? createEmptyAnnualAnnotations(),
      cells,
      maxValue: Math.max(1, ...cells.map((cell) => cell.seconds)),
      contributionDays: cells.filter((cell) => cell.inYear && cell.seconds > 0).length,
    };
  });

  return {
    overall: {
      totalReadTime: yearRows.reduce((sum, row) => sum + row.totalReadTime, 0),
    },
    years,
    records,
  };
}

function groupByYear<T extends { year: number }>(rows: T[]) {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const items = map.get(row.year);
    if (items) {
      items.push(row);
    } else {
      map.set(row.year, [row]);
    }
  }
  return map;
}

function createEmptyAnnualAnnotations(): HistoryYearRecord["annotations"] {
  return {
    notebookBooks: 0,
    highlights: 0,
    reviews: 0,
    recentHighlights: [],
    recentReviews: [],
  };
}

async function buildAnnualAnnotations(repos: RepoCtx, years: number[]) {
  const annotations = new Map<number, HistoryYearRecord["annotations"]>();

  for (const year of years) {
    annotations.set(year, createEmptyAnnualAnnotations());
  }

  const [stats, highlightPreviews, reviewPreviews] = await Promise.all([
    repos.notebook.listAnnualAnnotationStats(years),
    repos.notebook.listAnnualHighlightPreviews(years, ANNUAL_ANNOTATION_PREVIEW_LIMIT),
    repos.notebook.listAnnualReviewPreviews(years, ANNUAL_ANNOTATION_PREVIEW_LIMIT),
  ]);

  stats.highlightStats.forEach(row => {
    const annual = annotations.get(row.year);
    if (!annual) return;
    annual.highlights = row.highlights;
    annual.notebookBooks = Math.max(annual.notebookBooks, row.highlightBooks);
  })
  stats.reviewStats.forEach(row => {
    const annual = annotations.get(row.year);
    if (!annual) return;
    annual.reviews = row.reviews;
    annual.notebookBooks = Math.max(annual.notebookBooks, row.reviewBooks);
  })
  highlightPreviews.forEach(row => {
    annotations.get(row.year)?.recentHighlights.push(row)
  })
  reviewPreviews.forEach(row => {
    annotations.get(row.year)?.recentReviews.push(row)
  })

  return annotations;
}

function buildCalendarCells(year: number, dayRows: Array<{ day: string; readSeconds: number }>) {
  const dayMap = new Map(dayRows.map((row) => [row.day, row.readSeconds]));
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const mondayAlignedStart = new Date(start);
  const mondayOffset = (mondayAlignedStart.getUTCDay() + 6) % 7;
  mondayAlignedStart.setUTCDate(mondayAlignedStart.getUTCDate() - mondayOffset);
  const cells = [];
  const cursor = new Date(mondayAlignedStart);

  while (cursor <= end || ((cursor.getUTCDay() + 6) % 7) !== 0) {
    const current = new Date(cursor);
    const key = formatDateKey(current);
    const inYear = current.getUTCFullYear() === year;
    const diffDays = Math.floor((current.getTime() - mondayAlignedStart.getTime()) / 86_400_000);
    cells.push({
      key,
      label: key,
      month: current.getUTCMonth(),
      weekIndex: Math.floor(diffDays / 7),
      weekDayIndex: (current.getUTCDay() + 6) % 7,
      inYear,
      seconds: inYear ? dayMap.get(key) ?? 0 : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return cells;
}
