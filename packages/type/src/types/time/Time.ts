/**
 * Downcity 跨包时间格式协议。
 *
 * 关键点（中文）
 * - 时区与日期格式是 Agent、City Power 与 Power 实现共用的口径；口径漂移会让模型
 *   在不同来源看到不一致的日期，因此定义在共享定义层。
 * - 全部为纯函数：只依赖 JS 标准库 `Intl`，不读取进程状态、不访问 IO。
 * - 日期统一使用 sv-SE locale，输出 ISO 风格 `YYYY-MM-DD`，便于模型稳定解析。
 */

/** 读取当前运行时进程的 IANA 时区名称；无法解析时回退到 UTC。 */
export function resolve_runtime_timezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return String(timezone || "").trim() || "UTC";
}

/** 把日期格式化为指定时区下的 `YYYY-MM-DD`。 */
export function format_date_in_timezone(
  date: Date = new Date(),
  timezone: string = resolve_runtime_timezone(),
): string {
  try {
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

/** 把日期时间格式化为指定时区下的 `YYYY-MM-DDTHH:mm:ss (timezone)`。 */
export function format_date_time_in_timezone(
  date: Date = new Date(),
  timezone: string = resolve_runtime_timezone(),
): string {
  try {
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

/** 把日期格式化为指定时区下的年份。 */
export function format_year_in_timezone(
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
