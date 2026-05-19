export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes} 分钟`;
  }

  return `${hours} 小时 ${minutes} 分钟`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "未知时间";
  }

  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function formatCompare(compare: number | undefined): string {
  if (compare === undefined) {
    return "暂无";
  }

  const percentage = Math.round(compare * 100);
  return percentage > 0 ? `+${percentage}%` : `${percentage}%`;
}

export function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
