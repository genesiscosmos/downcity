/** 模型数值的展示格式化；只负责数字，单位文案由调用方提供。 */

/** 把 token 数折算成紧凑写法：128 / 500K / 1.5M。 */
export function format_token_count(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/** 把美元价格限制为最多三位有效数字，避免详情里出现 0.000123 这类长尾。 */
export function format_usd_price(value: number): string {
  return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

/** 把整数按当前语言分组；小数最多保留两位。 */
export function format_credit_amount(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** 大数按紧凑写法展示，用于「总 token」这类汇总值。 */
export function format_compact_number(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
