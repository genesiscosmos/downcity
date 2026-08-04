/**
 * 用户用量日期与 IANA 时区工具。
 *
 * 数据库只使用 UTC 范围索引筛选候选记录；当地自然日转换统一交给 Intl，
 * 避免 SQLite、D1 与 PostgreSQL 时区能力差异进入领域逻辑。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 带时区安全余量的 UTC 候选范围。 */
export interface UsageUtcEnvelope {
  /** 候选范围起点，包含。 */
  from_utc: string;
  /** 候选范围终点，不包含。 */
  to_utc_exclusive: string;
}

/** 根据当地日期范围生成覆盖全部合法时区的 UTC 候选范围。 */
export function create_usage_utc_envelope(from: string, to: string): UsageUtcEnvelope {
  const from_ms = Date.parse(`${from}T00:00:00.000Z`);
  const to_ms = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(from_ms) || !Number.isFinite(to_ms)) {
    throw new TypeError("Usage date range is invalid");
  }
  return {
    from_utc: new Date(from_ms - DAY_MS).toISOString(),
    to_utc_exclusive: new Date(to_ms + 2 * DAY_MS).toISOString(),
  };
}

/** 创建稳定输出 YYYY-MM-DD 的 IANA 当地日期格式器。 */
export function create_usage_date_formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 把 UTC 时间转换为指定时区的 YYYY-MM-DD。 */
export function format_usage_local_date(
  formatter: Intl.DateTimeFormat,
  timestamp: string,
): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Usage timestamp is invalid");
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new TypeError("Usage local date could not be formatted");
  return `${year}-${month}-${day}`;
}

/** 把数据库数值规范为非负安全整数；非法值按零处理。 */
export function read_usage_integer(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
