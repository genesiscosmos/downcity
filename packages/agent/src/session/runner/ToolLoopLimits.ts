/**
 * ToolLoopLimits：工具循环的边界与边界提示。
 *
 * 关键点（中文）：这里只描述「循环能跑多久」以及撞到边界时对模型说什么，
 * 不参与循环决策本身。
 */

/**
 * 单次 Tool Loop 允许的最大 Step 数。
 *
 * 关键点（中文）
 * - Step 计的是模型往返次数，不是工具调用次数；一次 shell 调用就会消耗一个 Step。
 * - 该上限只用于防止跑飞，正常运行不应触达；旧值 64 很容易被稍长的排查任务撞顶。
 * - 撞顶不再静默成功：先强制执行一次收尾 Step，收尾仍无正文时才按明确错误结束。
 */
export const MAX_TOOL_LOOP_STEPS = 1000;

/** Tool Loop 撞顶且收尾失败时写入 canonical Error Part 的稳定错误码。 */
export const TOOL_LOOP_MAX_STEPS_ERROR_CODE = "tool_loop_max_steps";

/** 不完整响应自动恢复的最大次数。 */
export const MAX_INCOMPLETE_RESPONSE_RECOVERIES = 1;

/** 构造不完整响应恢复提示。 */
export function build_incomplete_response_recovery_nudge(
  recovery_index: number,
): string {
  const round = Math.max(1, recovery_index);
  return [
    `系统恢复提醒（第 ${round} 次）：上一轮响应在流式阶段异常中断。`,
    "不要复述已完成内容。",
    "请从中断处继续；如果需要工具，请重新发起完整工具调用。",
    "只有在答案完整结束、任务真正完成、或明确受阻时才停止。",
  ].join("\n");
}

/**
 * 构造工具循环撞顶后的收尾提示。
 *
 * 关键点（中文）：这里只描述收尾要求，不解释工具循环机制，避免模型继续尝试调用工具。
 */
export function build_max_steps_finalization_nudge(step_limit: number): string {
  return [
    `系统收尾提醒：本轮已经连续执行 ${step_limit} 个模型 Step，达到工具循环上限。`,
    "现在不允许再调用任何工具。",
    "请基于已经完成的工具结果直接给出结论；若任务尚未完成，请明确说明已完成部分、当前受阻原因和下一步建议。",
  ].join("\n");
}

/** 构造工具循环撞顶收尾失败时的用户可见错误文本。 */
export function build_max_steps_error_text(step_limit: number): string {
  return `Agent reached the tool loop limit of ${step_limit} steps without producing a final answer.`;
}
