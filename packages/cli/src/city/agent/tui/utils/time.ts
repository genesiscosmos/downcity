/**
 * TUI 时间格式化工具。
 */

/**
 * 将时间戳格式化为相对时间。
 *
 * @param timestamp_ms 毫秒时间戳。
 * @returns 相对时间文本，如 "just now" / "5m ago" / "2h ago" / "3d ago"。
 */
export function formatRelativeTime(timestamp_ms: number): string {
  if (!Number.isFinite(timestamp_ms) || timestamp_ms <= 0) {
    return "";
  }
  const diff_sec = Math.floor(Math.max(0, Date.now() - timestamp_ms) / 1000);
  if (diff_sec < 60) {
    return "just now";
  }
  const minutes = Math.floor(diff_sec / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}
