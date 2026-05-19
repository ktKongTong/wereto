import { useEffect, useState } from "react";

import type { HistoryYearRecord } from "../../api/weread";
import { formatDate, formatDuration } from "../../lib/format";
import { useHistoryQuery, useSessionQuery } from "../../lib/queries";
import { useShell } from "./layout";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HistoryPage() {
  return <HistoryScreen />;
}

function HistoryScreen() {
  const session = useSessionQuery();
  const canView = Boolean(session.data?.authenticated || session.data?.public);
  const { data, error, isPending } = useHistoryQuery(canView);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const { openSettings } = useShell();

  useEffect(() => {
    if (!session.isPending && !canView) {
      openSettings("account");
    }
  }, [canView, openSettings, session.isPending]);

  useEffect(() => {
    if (data && activeYear === null) {
      setActiveYear(data.records.at(0)?.year ?? null);
    }
  }, [activeYear, data]);

  if (error) {
    return <main className="mx-auto max-w-5xl px-6 py-20 text-red-600">{error instanceof Error ? error.message : "加载失败"}</main>;
  }

  if (!session.isPending && !canView) {
    return (
      <section className="max-w-xl space-y-4 pt-10">
        <h2 className="text-3xl font-semibold text-foreground">Private archive, please sign in first</h2>
      </section>
    );
  }

  if (session.isPending || isPending || !data || activeYear === null) {
    return <main className="mx-auto max-w-5xl px-6 py-20 text-foreground/60">Loading history...</main>;
  }

  const activeRecord = data.records.find((record) => record.year === activeYear) ?? data.records.at(-1)!;
  const splitHeatmapSegments = splitHeatmapCells(activeRecord.cells);

  return (
    <section className="mx-auto grid w-full max-w-4xl gap-10 max-md:gap-8">
        <section className="grid min-w-0 gap-8 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start">
          <ActivityStats record={activeRecord} />

          <div className="min-w-0 overflow-hidden md:overflow-visible">
            <div className="mb-4 text-3xl font-semibold text-foreground md:text-4xl">Activity</div>
            <div className="flex w-full min-w-0 flex-col gap-5 overflow-hidden md:flex-row md:items-start md:overflow-visible">
              <div data-year-list className="flex w-full min-w-0 max-w-full gap-4 overflow-x-auto overflow-y-hidden px-0.5 md:w-auto md:flex-col md:overflow-visible md:scrollbar-none max-md:w-[calc(100vw-40px)] max-md:max-w-[calc(100vw-40px)] max-md:[&::-webkit-scrollbar]:hidden">
                {data.records.map((record) => (
                  <button
                    key={record.year}
                    type="button"
                    onClick={() => setActiveYear(record.year)}
                    className={[
                      "grid min-h-7 flex-none justify-items-start text-left text-muted-foreground transition duration-150 hover:text-foreground/80",
                      record.year === activeYear ? "translate-x-0.5 text-foreground max-md:translate-x-0" : "",
                    ].join(" ")}
                    aria-current={record.year === activeYear ? "true" : undefined}
                  >
                    <span
                      className={[
                        "leading-none text-xl",
                        record.year === activeYear ? "text-[24px] text-foreground" : "",
                      ].join(" ")}
                    >
                      {record.year}
                    </span>
                  </button>
                ))}
              </div>
              <Heatmap maxValue={activeRecord.maxValue} splitSegments={splitHeatmapSegments} />
            </div>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-3 lg:items-start">
          <RankList
            title="Top Read"
            items={(activeRecord.annual.readLongest ?? []).slice(0, 10).map((item) => ({
              cover: item.book?.cover ?? item.albumInfo?.cover ?? "",
              primary: item.book?.title ?? item.albumInfo?.name ?? "未知条目",
              secondary: item.book?.author ?? item.albumInfo?.authorName ?? "",
              meta: formatDuration(item.readTime ?? 0),
            }))}
          />
          <AnnotationList title="Highlight" items={activeRecord.annotations.recentHighlights} emptyText={`No highlights in ${activeRecord.year}`} />
          <AnnotationList title="Review" items={activeRecord.annotations.recentReviews} emptyText={`No reviews in ${activeRecord.year}`} />
        </section>
    </section>
  );
}

type HistoryCell = {
  key: string;
  label: string;
  seconds: number;
  month: number;
  weekIndex: number;
  inYear: boolean;
};

type HeatmapSegment = {
  id: string;
  cells: HistoryCell[];
  firstWeek: number;
  weekCount: number;
  monthMarkers: Array<{ month: number; column: number }>;
};

function splitHeatmapCells(cells: HistoryCell[]): HeatmapSegment[] {
  const segments = [
    createHeatmapSegment("first", cells, 0, 26),
    createHeatmapSegment("second", cells, 26, 53),
  ];
  return segments.filter((segment) => segment.cells.length > 0);
}

function createHeatmapSegment(id: string, cells: HistoryCell[], startWeek: number, endWeek: number): HeatmapSegment {
  const segmentCells = cells.filter((cell) => cell.weekIndex >= startWeek && cell.weekIndex < endWeek);
  const seen = new Set<number>();
  const monthMarkers = segmentCells.flatMap((cell) => {
    if (!cell.inYear) return [];
    const date = new Date(`${cell.label}T00:00:00Z`);
    if (date.getUTCDate() <= 7 && !seen.has(cell.month)) {
      seen.add(cell.month);
      return [{ month: cell.month, column: cell.weekIndex - startWeek + 2 }];
    }
    return [];
  });

  return {
    id,
    cells: segmentCells,
    firstWeek: startWeek,
    weekCount: endWeek - startWeek,
    monthMarkers,
  };
}

function Heatmap({
  maxValue,
  splitSegments,
}: {
  maxValue: number;
  splitSegments: HeatmapSegment[];
}) {
  return (
    <div className="flex flex-col items-center w-fit gap-9 [--history-cell:12px] [--history-gap:3px] max-md:-mx-3 max-md:w-[calc(100%+24px)] max-md:[--history-cell:10px] max-md:[--history-gap:3px]">
      {splitSegments.map((segment) => (
        <HeatmapSegmentView key={segment.id} maxValue={maxValue} segment={segment} />
      ))}
    </div>
  );
}

function HeatmapSegmentView({
  className = "",
  maxValue,
  segment,
}: {
  className?: string;
  maxValue: number;
  segment: HeatmapSegment;
}) {
  return (
    <div
      className={`w-fit max-w-full [--history-weeks:27] ${className}`}
      style={{ "--history-weeks": segment.weekCount } as React.CSSProperties}
    >
      <div className="mb-2 grid grid-cols-[32px_repeat(var(--history-weeks),var(--history-cell))] gap-[var(--history-gap)] max-sm:grid-cols-[20px_repeat(var(--history-weeks),var(--history-cell))]">
        <div />
        {segment.monthMarkers.map((item) => (
          <div key={`${segment.id}-${item.month}-${item.column}`} className="text-[11px] text-muted-foreground/75" style={{ gridColumn: item.column }}>
            {MONTH_LABELS[item.month]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[30px_auto] gap-2 max-sm:grid-cols-[18px_auto]">
        <div className="grid grid-rows-7 gap-1 pt-px text-[10px] text-muted-foreground/55">
          <span>Mon</span>
          <span className="invisible">.</span>
          <span>Wed</span>
          <span className="invisible">.</span>
          <span>Fri</span>
          <span className="invisible">.</span>
          <span className="invisible">.</span>
        </div>
        <div className="grid grid-flow-col grid-rows-7 grid-cols-[repeat(var(--history-weeks),var(--history-cell))] gap-[var(--history-gap)]">
          {segment.cells.map((cell) => {
            const level = !cell.inYear || cell.seconds === 0 ? 0 : Math.max(1, Math.ceil((cell.seconds / maxValue) * 4));
            return (
              <div
                key={cell.key}
                className="size-[var(--history-cell)] rounded-[3px] transition hover:scale-110"
                style={{
                  opacity: cell.inYear ? 1 : 0.18,
                  backgroundColor: `var(--level-${level})`,
                }}
                title={`${cell.label} · ${formatDuration(cell.seconds)}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActivityStats({ record }: { record: HistoryYearRecord }) {
  return (
    <aside className="grid grid-cols-2 gap-x-6 gap-y-6 xl:grid-cols-1">
      <Metric label="Read Time" value={formatDuration(record.annual.totalReadTime)} />
      <Metric label="Notebook Books" value={String(record.annotations.notebookBooks)} />
      <Metric label="Highlight" value={String(record.annotations.highlights)} />
      <Metric label="Review" value={String(record.annotations.reviews)} />
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/75">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function AnnotationList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ bookTitle: string; cover: string; content: string; createTime: number }>;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-foreground">{title}</h2>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.slice(0, 10).map((item, index) => (
            <div key={`${title}-${item.bookTitle}-${item.createTime}-${index}`} className="grid grid-cols-[44px_1fr] gap-3">
              {item.cover ? <img src={item.cover} alt="" className="size-11 rounded-md object-cover" /> : <div className="size-11 rounded-md bg-muted" />}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground/75">
                  <span>{formatDate(item.createTime)}</span>
                </div>
                <div className="truncate text-sm text-foreground/80">{item.bookTitle}</div>
                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.content}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground/75">{emptyText}</div>
      )}
    </section>
  );
}

function RankList({
  title,
  items,
}: {
  title: string;
  items: Array<{ cover: string; primary: string; secondary: string; meta: string }>;
}) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${item.primary}-${item.meta}`} className="grid grid-cols-[44px_1fr] gap-3">
            {item.cover ? <img src={item.cover} alt="" className="size-11 rounded-md object-cover" /> : <div className="size-11 rounded-md bg-muted" />}
            <div>
              <div className="text-sm text-foreground">{item.primary}</div>
              <div className="text-xs text-muted-foreground">{item.secondary}</div>
              <div className="text-xs text-muted-foreground/75">{item.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
