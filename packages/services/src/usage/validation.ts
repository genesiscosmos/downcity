/** 用户用量查询参数与最近记录 Cursor 协议模块。 */

import {
  base64UrlDecode,
  base64UrlEncode,
  httpError,
  type AIRecentUsageCursor,
  type AIRecentUsageItem,
  type AdminUsageQuery,
  type UserDailyUsageQuery,
  type UserRecentAIUsageQuery,
} from "@downcity/federation";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_USAGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_USAGE_LIMIT = 20;
const MAX_RECENT_USAGE_LIMIT = 50;
const MAX_RECENT_USAGE_CURSOR_LENGTH = 2_048;

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

/** 校验 Admin 跨用户用量查询。 */
export function validate_admin_usage_query(input: {
  /** 起始当地自然日。 */
  from: unknown;
  /** 结束当地自然日。 */
  to: unknown;
  /** IANA 时区。 */
  timezone: unknown;
}): AdminUsageQuery {
  const query = validate_usage_query({
    user_id: "__admin__",
    from: input.from,
    to: input.to,
    timezone: input.timezone,
  });
  return { from: query.from, to: query.to, timezone: query.timezone };
}

/** 校验最近单次 AI Usage 查询，并把不透明 Cursor 还原为稳定排序边界。 */
export function validate_recent_usage_query(input: {
  user_id: string;
  limit: unknown;
  cursor: unknown;
}): UserRecentAIUsageQuery {
  const limit = read_recent_usage_limit(input.limit);
  const cursor = read_recent_usage_cursor(input.cursor);
  return {
    user_id: input.user_id,
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

/** 根据当前页最后一条记录生成不透明的下一页 Cursor。 */
export function create_recent_usage_cursor(item: AIRecentUsageItem): string {
  return base64UrlEncode(JSON.stringify([item.completed_at, item.usage_id]));
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

/** 读取最近记录页大小。 */
function read_recent_usage_limit(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_RECENT_USAGE_LIMIT;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw httpError(400, `INVALID_USAGE_LIMIT: limit must be an integer between 1 and ${MAX_RECENT_USAGE_LIMIT}`);
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECENT_USAGE_LIMIT) {
    throw httpError(400, `INVALID_USAGE_LIMIT: limit must be an integer between 1 and ${MAX_RECENT_USAGE_LIMIT}`);
  }
  return limit;
}

/** 解码并校验服务端生成的最近记录 Cursor。 */
function read_recent_usage_cursor(value: unknown): AIRecentUsageCursor | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_RECENT_USAGE_CURSOR_LENGTH) {
    throw httpError(400, "INVALID_USAGE_CURSOR: cursor is invalid");
  }
  try {
    const decoded = JSON.parse(base64UrlDecode(value)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2) throw new TypeError("invalid cursor tuple");
    const [completed_at, usage_id] = decoded;
    if (
      typeof completed_at !== "string"
      || new Date(completed_at).toISOString() !== completed_at
      || typeof usage_id !== "string"
      || usage_id.length === 0
      || usage_id.length > 500
    ) {
      throw new TypeError("invalid cursor boundary");
    }
    return { completed_at, usage_id };
  } catch {
    throw httpError(400, "INVALID_USAGE_CURSOR: cursor is invalid");
  }
}
