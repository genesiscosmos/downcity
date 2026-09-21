/**
 * 时间格式工具模块。
 *
 * 关键点（中文）
 * - 时区与日期格式的实现已归位到 `@downcity/type`，与 City Power 共享同一口径。
 * - 本模块只保留 Agent 侧独有的时间戳能力，并重导出定义层函数，避免出现两份实现。
 */

export {
  format_date_in_timezone,
  format_date_time_in_timezone,
  format_year_in_timezone,
  resolve_runtime_timezone,
} from "@downcity/type";

/** 返回当前 UTC 时间戳的 ISO 字符串。 */
export function get_timestamp(): string {
  return new Date().toISOString();
}
