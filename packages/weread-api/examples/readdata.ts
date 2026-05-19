import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { createWereadClient, type ReadDataDetailResponse, type ReadDataLongestItem } from "../src/index.ts";

loadEnvFile();

const OUTPUT_PATH = resolve("examples/output/readdata-history-dashboard.html");
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["Mon", "Wed", "Fri"];

async function main() {
  const client = createWereadClient({
    onRequest(request) {
      console.log("->", request.method, request.url);
    },
    onResponse(response) {
      console.log("<-", response.status, response.statusText);
    },
  });

  const overall = await client.getReadData({ mode: "overall" });
  const years = resolveAvailableYears(overall);
  const annualRecords = await Promise.all(years.map((year) => loadYearRecord(client, year)));
  const html = renderHtml(overall, annualRecords);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, html, "utf8");

  console.log(
    JSON.stringify(
      {
        years,
        totalYears: years.length,
        overallReadTimeSeconds: overall.totalReadTime ?? 0,
        overallReadTimeLabel: formatDuration(overall.totalReadTime ?? 0),
        outputPath: OUTPUT_PATH,
      },
      null,
      2,
    ),
  );
}

function resolveAvailableYears(overall: ReadDataDetailResponse): number[] {
  const currentYear = new Date().getFullYear();
  const yearsFromReport =
    overall.yearReport
      ?.map((item) => item.year)
      .filter((value): value is number => Number.isInteger(value))
      .sort((a, b) => a - b) ?? [];

  if (yearsFromReport.length > 0) {
    return yearsFromReport;
  }

  const startYear = overall.registTime ? new Date(overall.registTime * 1000).getFullYear() : currentYear;
  return Array.from({ length: currentYear - startYear + 1 }, (_, index) => startYear + index);
}

async function loadYearRecord(client: ReturnType<typeof createWereadClient>, year: number): Promise<YearRecord> {
  const annual = await client.getReadData({
    mode: "annually",
    baseTime: createYearTimestamp(year),
  });

  const dailyMap = await loadDailyReadMap(client, year, annual);
  const cells = buildCalendarCells(year, dailyMap);
  const totalContributionDays = cells.filter((cell) => cell.inYear && cell.seconds > 0).length;
  const maxValue = Math.max(1, ...cells.map((cell) => cell.seconds));

  return {
    year,
    annual,
    dailyMap,
    cells,
    maxValue,
    contributionDays: totalContributionDays,
  };
}

function createYearTimestamp(year: number): number {
  return Math.floor(Date.UTC(year, 0, 1) / 1000);
}

async function loadDailyReadMap(
  client: ReturnType<typeof createWereadClient>,
  year: number,
  annual: ReadDataDetailResponse,
): Promise<Map<string, number>> {
  if (annual.dailyReadTimes && Object.keys(annual.dailyReadTimes).length > 0) {
    return normalizeDailyMap(annual.dailyReadTimes);
  }

  const map = new Map<string, number>();

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthly = await getMonthlyWithRetry(client, year, monthIndex);
    const buckets = monthly.readTimes ?? monthly.dailyReadTimes ?? {};
    for (const [timestamp, seconds] of Object.entries(buckets)) {
      const key = formatDateKey(new Date(Number(timestamp) * 1000));
      map.set(key, (map.get(key) ?? 0) + seconds);
    }
  }

  return map;
}

async function getMonthlyWithRetry(
  client: ReturnType<typeof createWereadClient>,
  year: number,
  monthIndex: number,
): Promise<ReadDataDetailResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.getReadData({
        mode: "monthly",
        baseTime: Math.floor(Date.UTC(year, monthIndex, 1) / 1000),
      });
    } catch (error) {
      lastError = error;
      await sleep(300 * (attempt + 1));
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDailyMap(source: Record<string, number>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [timestamp, seconds] of Object.entries(source)) {
    const key = formatDateKey(new Date(Number(timestamp) * 1000));
    map.set(key, seconds);
  }
  return map;
}

function buildCalendarCells(year: number, dailyMap: Map<string, number>): CalendarCell[] {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const mondayAlignedStart = new Date(start);
  const mondayOffset = (mondayAlignedStart.getUTCDay() + 6) % 7;
  mondayAlignedStart.setUTCDate(mondayAlignedStart.getUTCDate() - mondayOffset);

  const cells: CalendarCell[] = [];
  const cursor = new Date(mondayAlignedStart);

  while (cursor <= end || ((cursor.getUTCDay() + 6) % 7) !== 0) {
    const current = new Date(cursor);
    const key = formatDateKey(current);
    const inYear = current.getUTCFullYear() === year;
    const diffDays = Math.floor((current.getTime() - mondayAlignedStart.getTime()) / 86_400_000);
    const weekIndex = Math.floor(diffDays / 7);
    const weekDayIndex = (current.getUTCDay() + 6) % 7;

    cells.push({
      key,
      date: current,
      inYear,
      weekIndex,
      weekDayIndex,
      seconds: inYear ? dailyMap.get(key) ?? 0 : 0,
      month: current.getUTCMonth(),
      label: formatLongDate(current),
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > end && ((cursor.getUTCDay() + 6) % 7) === 0) {
      break;
    }
  }

  return cells;
}

function renderHtml(overall: ReadDataDetailResponse, records: YearRecord[]): string {
  const latest = records.at(-1);
  if (!latest) {
    throw new Error("No annual records available");
  }

  const overviewCards = [
    {
      label: "历史总阅读时长",
      value: formatDuration(overall.totalReadTime ?? 0),
    },
    {
      label: "历史阅读天数",
      value: `${records.reduce((sum, record) => sum + (record.annual.readDays ?? 0), 0)} 天`,
    },
    {
      label: "覆盖年份",
      value: `${records[0]?.year ?? latest.year} - ${latest.year}`,
    },
    {
      label: "已收录年度",
      value: `${records.length} 年`,
    },
  ]
    .map(
      (item) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(item.label)}</div>
          <div class="metric-value">${escapeHtml(item.value)}</div>
        </div>
      `,
    )
    .join("");

  const tabs = records
    .map(
      (record, index) => `
        <button class="year-tab${index === records.length - 1 ? " active" : ""}" data-year="${record.year}">
          <span>${record.year}</span>
          <small>${formatDuration(record.annual.totalReadTime ?? 0)}</small>
        </button>
      `,
    )
    .join("");

  const panels = records
    .map((record, index) => renderYearPanel(record, index === records.length - 1))
    .join("");

  const initialState = JSON.stringify(
    records.map((record) => ({
      year: record.year,
      totalReadTime: record.annual.totalReadTime ?? 0,
      readDays: record.annual.readDays ?? 0,
      contributionDays: record.contributionDays,
      compare: record.annual.compare ?? null,
    })),
  );

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>微信读书历史阅读热力图</title>
    <style>
      :root {
        --bg: #f4f0e8;
        --paper: rgba(255, 251, 245, 0.96);
        --ink: #1d1a16;
        --muted: #786c61;
        --line: #e8dcc9;
        --accent: #a04e28;
        --level-0: #f1e8dc;
        --level-1: #e3c9aa;
        --level-2: #d1905c;
        --level-3: #b85f30;
        --level-4: #7d3414;
        --shadow: 0 24px 60px rgba(68, 41, 20, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        background:
          radial-gradient(circle at top left, rgba(184,95,48,.14), transparent 20%),
          radial-gradient(circle at bottom right, rgba(125,52,20,.08), transparent 24%),
          linear-gradient(180deg, #f8f4ed 0%, #f1ebe1 100%);
      }
      .page {
        max-width: 1380px;
        margin: 0 auto;
        padding: 32px 18px 56px;
      }
      .hero, .panel {
        background: var(--paper);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
      }
      .hero {
        padding: 28px;
        margin-bottom: 18px;
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        letter-spacing: .24em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 4vw, 60px);
        line-height: .95;
      }
      .lede {
        max-width: 760px;
        margin: 14px 0 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.6;
      }
      .overview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .metric-card {
        padding: 16px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.46);
      }
      .metric-label {
        font-size: 12px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .metric-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 700;
      }
      .panel {
        padding: 22px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
      }
      .toolbar-title {
        margin: 0;
        font-size: 24px;
      }
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .year-tab {
        border: 1px solid var(--line);
        background: #fffaf3;
        color: var(--ink);
        padding: 10px 12px;
        min-width: 96px;
        cursor: pointer;
        transition: transform .16s ease, border-color .16s ease, background .16s ease;
      }
      .year-tab:hover {
        transform: translateY(-1px);
        border-color: #d8b28f;
      }
      .year-tab.active {
        background: linear-gradient(180deg, #c9733d, #9c491d);
        color: #fff8f0;
        border-color: #9c491d;
      }
      .year-tab span,
      .year-tab small {
        display: block;
      }
      .year-tab small {
        margin-top: 4px;
        opacity: .72;
      }
      .year-panel {
        display: none;
      }
      .year-panel.active {
        display: block;
      }
      .year-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .year-summary-card {
        padding: 14px 16px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.5);
      }
      .year-summary-card strong {
        display: block;
        margin-top: 6px;
        font-size: 24px;
      }
      .heatmap-shell {
        border: 1px solid var(--line);
        background: rgba(255,255,255,.58);
        padding: 18px;
      }
      .heatmap-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 12px;
      }
      .heatmap-title h3 {
        margin: 0;
        font-size: 20px;
      }
      .heatmap-title p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .months {
        display: grid;
        grid-template-columns: 32px repeat(53, 14px);
        gap: 4px;
        margin-left: 28px;
        margin-bottom: 6px;
        min-width: 860px;
      }
      .month {
        font-size: 12px;
        color: var(--muted);
        cursor: default;
      }
      .calendar {
        display: grid;
        grid-template-columns: 28px auto;
        gap: 10px;
        min-width: 900px;
      }
      .weekdays {
        display: grid;
        grid-template-rows: repeat(7, 14px);
        gap: 4px;
        padding-top: 1px;
      }
      .weekday {
        font-size: 11px;
        line-height: 14px;
        color: var(--muted);
      }
      .weekday.hidden {
        visibility: hidden;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(53, 14px);
        grid-template-rows: repeat(7, 14px);
        grid-auto-flow: column;
        gap: 4px;
      }
      .cell {
        position: relative;
        width: 14px;
        height: 14px;
        border-radius: 3px;
        background: var(--level-0);
        transition: transform .12s ease, outline-color .12s ease;
        outline: 1px solid transparent;
      }
      .cell:hover,
      .cell:focus-visible {
        transform: scale(1.16);
        outline-color: rgba(160,78,40,.45);
        z-index: 2;
      }
      .cell.level-0 { background: var(--level-0); }
      .cell.level-1 { background: var(--level-1); }
      .cell.level-2 { background: var(--level-2); }
      .cell.level-3 { background: var(--level-3); }
      .cell.level-4 { background: var(--level-4); }
      .cell.outside {
        opacity: .2;
      }
      .legend {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
        color: var(--muted);
        font-size: 12px;
      }
      .legend-scale {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .legend-swatch {
        width: 14px;
        height: 14px;
        border-radius: 3px;
      }
      .tooltip {
        position: fixed;
        pointer-events: none;
        z-index: 20;
        max-width: 240px;
        padding: 10px 12px;
        background: rgba(28, 22, 17, 0.94);
        color: #fffaf3;
        border-radius: 10px;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 18px 40px rgba(0,0,0,.18);
        opacity: 0;
        transform: translate3d(0, 8px, 0);
        transition: opacity .12s ease, transform .12s ease;
      }
      .tooltip.visible {
        opacity: 1;
        transform: translate3d(0, 0, 0);
      }
      .details-grid {
        display: grid;
        grid-template-columns: 1.2fr .8fr;
        gap: 18px;
        margin-top: 18px;
      }
      .books-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 14px;
      }
      .book-card {
        display: grid;
        grid-template-columns: 70px 1fr;
        gap: 12px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.54);
        padding: 12px;
      }
      .book-cover {
        width: 70px;
        aspect-ratio: 0.72;
        object-fit: cover;
        border-radius: 8px;
        background: #eadfce;
        box-shadow: 0 10px 24px rgba(84, 52, 27, .14);
      }
      .book-title {
        margin: 0 0 6px;
        font-size: 16px;
      }
      .book-meta,
      .book-time {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .stats-list {
        display: grid;
        gap: 10px;
      }
      .stat-item {
        padding: 12px 14px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.54);
      }
      .stat-item strong {
        display: block;
        margin-top: 4px;
        font-size: 20px;
      }
      @media (max-width: 980px) {
        .details-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">WeRead History Dashboard</p>
        <h1>历史阅读热力图</h1>
        <p class="lede">
          以 GitHub 年度贡献图的交互方式浏览微信读书的历史阅读轨迹。每个年度面板展示总时长、阅读天数、
          年度热力分布，以及带封面的年度阅读重点书籍。
        </p>
        <div class="overview-grid">${overviewCards}</div>
      </section>

      <section class="panel">
        <div class="toolbar">
          <h2 class="toolbar-title">年度切换</h2>
          <div class="tabs">${tabs}</div>
        </div>
        ${panels}
      </section>
    </main>

    <div class="tooltip" id="tooltip"></div>
    <script type="application/json" id="dashboard-state">${escapeHtml(initialState)}</script>
    <script>
      const tooltip = document.getElementById("tooltip");
      const state = JSON.parse(document.getElementById("dashboard-state").textContent);
      const tabs = Array.from(document.querySelectorAll(".year-tab"));
      const panels = Array.from(document.querySelectorAll(".year-panel"));

      function activateYear(year) {
        tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.year === String(year)));
        panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.year === String(year)));
      }

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => activateYear(tab.dataset.year));
      });

      document.querySelectorAll("[data-tooltip]").forEach((element) => {
        element.addEventListener("mouseenter", showTooltip);
        element.addEventListener("mousemove", moveTooltip);
        element.addEventListener("mouseleave", hideTooltip);
        element.addEventListener("focus", showTooltip);
        element.addEventListener("blur", hideTooltip);
      });

      function showTooltip(event) {
        const message = event.currentTarget.dataset.tooltip;
        if (!message) return;
        tooltip.innerHTML = message;
        tooltip.classList.add("visible");
        moveTooltip(event);
      }

      function moveTooltip(event) {
        const x = event.clientX ?? (event.target.getBoundingClientRect().left + 10);
        const y = event.clientY ?? (event.target.getBoundingClientRect().top + 10);
        tooltip.style.left = x + 14 + "px";
        tooltip.style.top = y + 14 + "px";
      }

      function hideTooltip() {
        tooltip.classList.remove("visible");
      }
    </script>
  </body>
</html>`;
}

function renderYearPanel(record: YearRecord, active: boolean): string {
  const months = buildMonthMarkers(record.cells)
    .map(
      (item) => `
        <div
          class="month"
          style="grid-column:${item.column}"
          data-tooltip="${escapeHtml(`${MONTH_LABELS[item.month]} ${record.year}`)}"
        >${MONTH_LABELS[item.month]}</div>
      `,
    )
    .join("");

  const cells = record.cells
    .map((cell) => {
      const level = !cell.inYear ? 0 : cell.seconds === 0 ? 0 : Math.max(1, Math.ceil((cell.seconds / record.maxValue) * 4));
      const tooltip = `${cell.label}<br>${formatDuration(cell.seconds)}${cell.inYear ? "" : "<br>Outside this year"}`;
      return `
        <button
          type="button"
          class="cell level-${level}${cell.inYear ? "" : " outside"}"
          data-tooltip="${escapeHtml(tooltip)}"
          aria-label="${escapeHtml(`${cell.label}: ${formatDuration(cell.seconds)}`)}"
        ></button>
      `;
    })
    .join("");

  const topBooks = renderTopBooks(record.annual.readLongest ?? []);
  const compareText = formatCompare(record.annual.compare);
  const stats = [
    { label: "总阅读时长", value: formatDuration(record.annual.totalReadTime ?? 0) },
    { label: "阅读天数", value: `${record.annual.readDays ?? 0} 天` },
    { label: "活跃格子", value: `${record.contributionDays} 天` },
    { label: "同比前期", value: compareText },
  ]
    .map(
      (item) => `
        <div class="year-summary-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `,
    )
    .join("");

  const statItems = (record.annual.readStat ?? [])
    .map(
      (item) => `
        <div class="stat-item">
          <span>${escapeHtml(item.stat ?? "统计项")}</span>
          <strong>${escapeHtml(item.counts ?? "--")}</strong>
        </div>
      `,
    )
    .join("");

  return `
    <section class="year-panel${active ? " active" : ""}" data-year="${record.year}">
      <div class="year-summary">${stats}</div>
      <div class="heatmap-shell">
        <div class="heatmap-title">
          <h3>${record.contributionDays} days of reading in ${record.year}</h3>
          <p>总计 ${formatDuration(record.annual.totalReadTime ?? 0)}，每个方格代表一天阅读时长。</p>
        </div>
        <div style="overflow-x:auto;">
          <div class="months"><div></div>${months}</div>
          <div class="calendar">
            <div class="weekdays">
              ${["Mon", "", "Wed", "", "Fri", "", ""]
                .map((label) => `<div class="weekday${label ? "" : " hidden"}">${label || "·"}</div>`)
                .join("")}
            </div>
            <div class="grid">${cells}</div>
          </div>
        </div>
        <div class="legend">
          <span>${record.contributionDays} days with reading activity</span>
          <div class="legend-scale">
            <span>Less</span>
            <span class="legend-swatch" style="background:var(--level-0)"></span>
            <span class="legend-swatch" style="background:var(--level-1)"></span>
            <span class="legend-swatch" style="background:var(--level-2)"></span>
            <span class="legend-swatch" style="background:var(--level-3)"></span>
            <span class="legend-swatch" style="background:var(--level-4)"></span>
            <span>More</span>
          </div>
        </div>
      </div>

      <div class="details-grid">
        <article class="panel" style="margin-top:18px;">
          <h3 class="toolbar-title">年度重点阅读</h3>
          <div class="books-grid">${topBooks}</div>
        </article>
        <article class="panel" style="margin-top:18px;">
          <h3 class="toolbar-title">年度摘要</h3>
          <div class="stats-list">${statItems}</div>
        </article>
      </div>
    </section>
  `;
}

function renderTopBooks(items: ReadDataLongestItem[]): string {
  return items
    .slice(0, 6)
    .map((item) => {
      const title = item.book?.title ?? item.albumInfo?.name ?? "未知条目";
      const author = item.book?.author ?? item.albumInfo?.authorName ?? "";
      const cover = item.book?.cover ?? item.albumInfo?.cover ?? "";
      const readTime = formatDuration(item.readTime ?? 0);
      const coverMarkup = cover
        ? `<img class="book-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" loading="lazy" />`
        : `<div class="book-cover" aria-hidden="true"></div>`;

      return `
        <article class="book-card">
          ${coverMarkup}
          <div>
            <h4 class="book-title">${escapeHtml(title)}</h4>
            <p class="book-meta">${escapeHtml(author)}</p>
            <p class="book-time">${escapeHtml(readTime)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildMonthMarkers(cells: CalendarCell[]) {
  const markers: Array<{ month: number; column: number }> = [];
  const seen = new Set<number>();

  for (const cell of cells) {
    if (!cell.inYear) {
      continue;
    }
    if (cell.date.getUTCDate() <= 7 && !seen.has(cell.month)) {
      seen.add(cell.month);
      markers.push({ month: cell.month, column: cell.weekIndex + 2 });
    }
  }

  return markers;
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes} 分钟`;
  }

  return `${hours} 小时 ${minutes} 分钟`;
}

function formatCompare(compare: number | undefined): string {
  if (compare === undefined) {
    return "暂无";
  }

  const percentage = Math.round(compare * 100);
  return percentage > 0 ? `+${percentage}%` : `${percentage}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface CalendarCell {
  key: string;
  date: Date;
  inYear: boolean;
  weekIndex: number;
  weekDayIndex: number;
  seconds: number;
  month: number;
  label: string;
}

interface YearRecord {
  year: number;
  annual: ReadDataDetailResponse;
  dailyMap: Map<string, number>;
  cells: CalendarCell[];
  maxValue: number;
  contributionDays: number;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
