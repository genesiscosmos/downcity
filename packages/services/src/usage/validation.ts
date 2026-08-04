/** 用户用量查询参数校验模块。 */

import { httpError, type UserDailyUsageQuery } from "@downcity/city";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_USAGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 校验并返回用户每日用量查询。 */
export function validate_usage_query(input: {
  user_id: string;
  from: unknown;
  to: unknown;
  timezone: unknown;
}): UserDailyUsageQuery {
  const from = read_real_date(input.from);
  const to = read_real_date(input.to);
  if (!from || !to || from > to) {
    throw httpError(400, "INVALID_USAGE_DATE_RANGE: from and to must be valid ordered dates");
  }
  const days = Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
  if (days > MAX_USAGE_DAYS) {
    throw httpError(400, `USAGE_DATE_RANGE_TOO_LARGE: date range cannot exceed ${MAX_USAGE_DAYS} days`);
  }
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  try {
    if (!timezone) throw new RangeError("timezone is empty");
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw httpError(400, "INVALID_USAGE_TIMEZONE: timezone must be a valid IANA timezone");
  }
  return { user_id: input.user_id, from, to, timezone };
}

/** 读取并验证真实 Gregorian 日期。 */
function read_real_date(value: unknown): string | undefined {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : undefined;
}
