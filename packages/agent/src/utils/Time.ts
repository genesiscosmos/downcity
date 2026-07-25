/**
 * 时间格式工具模块。
 *
 * 职责说明：
 * 1. 提供统一时间戳格式。
 * 2. 提供耗时格式化，便于日志和 CLI 输出使用一致单位。
 * 3. 提供 runtime 时区格式化，确保 prompt / message / task 共享同一时间口径。
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

export function resolve_runtime_timezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return String(timezone || "").trim() || "UTC";
}

export function formatDateInTimezone(
  date: Date = new Date(),
  timezone: string = resolve_runtime_timezone(),
): string {
  try {
    // 关键点（中文）：sv-SE locale 默认输出 ISO 风格日期，便于模型稳定解析。
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function format_date_time_in_timezone(
  date: Date = new Date(),
  timezone: string = resolve_runtime_timezone(),
): string {
  try {
    // 关键点（中文）：使用固定格式，确保模型读取时区信息时稳定。
    const formatted = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(" ", "T");
    return `${formatted} (${timezone})`;
  } catch {
    return date.toISOString();
  }
}

export function formatYearInTimezone(
  date: Date = new Date(),
  timezone: string = resolve_runtime_timezone(),
): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    }).format(date);
  } catch {
    return String(date.getUTCFullYear());
  }
}
