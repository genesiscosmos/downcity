/**
 * city tool 的时间取数辅助。
 *
 * 关键点（中文）
 * - 时区与本地日期只在 city tool 内取一次，避免各 namespace 各自实现导致口径漂移。
 * - 取不到运行时时区时统一回退 UTC，不抛错，保证只读查询永远可用。
 */

/** 读取当前进程的运行时参考时区。 */
export function resolve_runtime_timezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
}

/** 按指定时区把时刻格式化为 YYYY-MM-DD。 */
export function format_local_date(input: {
  /** 待格式化的时刻。 */
  date: Date;
  /** IANA 时区名称。 */
  timezone: string;
}): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(input.date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // 非法时区名不能阻断只读查询，直接走 UTC 回退。
  }
  return input.date.toISOString().slice(0, 10);
}
