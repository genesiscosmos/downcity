/**
 * ContextPressure：上下文压力阈值判断。
 *
 * 本模块只判断真实 Provider usage 是否接近上下文窗口上限；具体选择、摘要和持久化
 * 全部归属于 SessionComposer 的上下文推进实现。
 */

/** usage 达到模型上下文窗口 95% 时安排下一 step 压缩。 */
export const CONTEXT_PRESSURE_RATIO = 0.95;

/** 读取 Provider usage 中的实际总 token。 */
export function resolve_usage_tokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const total_tokens = read_non_negative_number(record.total_tokens ?? record.totalTokens);
  if (total_tokens !== null) return total_tokens;
  const input_tokens = read_non_negative_number(record.input_tokens ?? record.inputTokens);
  const output_tokens = read_non_negative_number(record.output_tokens ?? record.outputTokens);
  if (input_tokens === null && output_tokens === null) return null;
  return (input_tokens ?? 0) + (output_tokens ?? 0);
}

/** 计算真实 usage 占当前模型上下文窗口的比例。 */
export function resolve_usage_ratio(
  usage: unknown,
  context_window: number | undefined,
): number | null {
  if (!Number.isSafeInteger(context_window) || Number(context_window) <= 0) return null;
  const used_tokens = resolve_usage_tokens(usage);
  return used_tokens === null ? null : used_tokens / Number(context_window);
}

/** 判断一次真实 usage 是否已接近上下文窗口上限。 */
export function is_context_pressured(
  usage_ratio: number | null,
): boolean {
  if (usage_ratio === null || !Number.isFinite(usage_ratio)) return false;
  return usage_ratio >= CONTEXT_PRESSURE_RATIO;
}

/** 读取非负数字。 */
function read_non_negative_number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
