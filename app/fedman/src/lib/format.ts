/** Fedman 展示格式化函数。 */

/** 格式化普通数值。 */
export function format_number(input: unknown): string {
  return Number(input || 0).toLocaleString();
}

/** 使用紧凑单位格式化大数值。 */
export function format_compact_number(input: unknown): string {
  const numeric_value = Number(input || 0);
  return Math.abs(numeric_value) >= 1_000
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(numeric_value)
    : format_number(numeric_value);
}

/** 将 0–1 比例格式化为百分比。 */
export function format_percent(input: unknown): string {
  return input === null || input === undefined ? "—" : `${(Number(input) * 100).toFixed(1)}%`;
}

/** 将毫秒格式化为毫秒或秒。 */
export function format_duration(input: unknown): string {
  if (input === null || input === undefined) return "—";
  const numeric_value = Number(input);
  return numeric_value >= 1_000 ? `${(numeric_value / 1_000).toFixed(2)}s` : `${Math.round(numeric_value)}ms`;
}

/** 将任意资源字段格式化为表格文本。 */
export function format_value(input: unknown): string {
  if (input === null || input === undefined) return "";
  return typeof input === "object" ? JSON.stringify(input) : String(input);
}

/** 将未知错误转换为用户可读消息。 */
export function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
