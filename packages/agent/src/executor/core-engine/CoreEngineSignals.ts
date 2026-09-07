/**
 * CoreEngine Tool Loop 的纯信号与诊断模块。
 *
 * 所有消息判断都直接读取 canonical `SessionAssistantMessagePart`，不依赖 UI 投影。
 */

import type { JsonObject } from "@downcity/type";
import type { SessionAssistantMessagePart } from "@downcity/type";

/** 单次 Tool Loop 允许的最大 Step 数。 */
export const MAX_TOOL_LOOP_STEPS = 64;

/** 不完整响应自动恢复的最大次数。 */
export const MAX_INCOMPLETE_RESPONSE_RECOVERIES = 1;

/** 调试日志中的文本预览最大长度。 */
const DEBUG_TEXT_PREVIEW_MAX_CHARS = 180;

/** 生成日志友好的单行预览文本。 */
export function to_inline_preview(value: unknown): string {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  return normalized.length > DEBUG_TEXT_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, DEBUG_TEXT_PREVIEW_MAX_CHARS)}...`
    : normalized;
}

/** 汇总单个 Step 的关键信号。 */
export function summarize_step_for_debug(step_result: unknown): JsonObject {
  const record = to_json_object(step_result) ?? {};
  const usage = to_json_object(record.usage);
  const response = to_json_object(record.response);
  const tool_calls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const tool_results = Array.isArray(record.tool_results) ? record.tool_results : [];
  const response_messages = Array.isArray(response?.messages)
    ? response.messages
    : [];
  return {
    finishReason:
      typeof record.finish_reason === "string" ? record.finish_reason : null,
    textLength: typeof record.text === "string" ? record.text.length : 0,
    textPreview: to_inline_preview(record.text),
    toolCallCount: tool_calls.length,
    toolCallNames: pick_tool_names(tool_calls),
    toolResultCount: tool_results.length,
    toolResultNames: pick_tool_names(tool_results),
    responseMessageCount: response_messages.length,
    responseMessageRoles: response_messages
      .map((item) => to_json_object(item)?.role)
      .filter((role): role is string => typeof role === "string")
      .slice(0, 8),
    inputTokens:
      typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens:
      typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    totalTokens:
      typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  };
}

/** 汇总最终 canonical Assistant Parts。 */
export function summarize_assistant_parts_for_debug(
  parts: readonly SessionAssistantMessagePart[],
): JsonObject {
  const text = extract_assistant_text(parts);
  const tool_names = parts
    .filter((part) => part.type === "tool")
    .map((part) => part.tool_name)
    .slice(0, 8);
  return {
    partCount: parts.length,
    partTypes: parts.map((part) => part.type).slice(0, 12),
    textLength: text.length,
    textPreview: to_inline_preview(text),
    toolPartCount: tool_names.length,
    toolNames: tool_names,
  };
}

/** 按 Step 顺序合并 canonical Assistant Parts。 */
export function merge_assistant_parts(
  base: readonly SessionAssistantMessagePart[],
  incoming: readonly SessionAssistantMessagePart[],
): SessionAssistantMessagePart[] {
  return [...base, ...incoming].map((part, index) => ({
    ...part,
    sequence: index + 1,
  }));
}

/** 从 canonical Assistant Parts 提取用户可见文本。 */
export function extract_assistant_text(
  parts: readonly SessionAssistantMessagePart[],
): string {
  const chat_send = [...parts].reverse().find(
    (part) => part.type === "tool" && part.tool_name === "chat_send",
  );
  if (chat_send?.type === "tool" && chat_send.input) {
    const input = to_json_object(chat_send.input);
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    if (text && chat_send.state === "completed") return text;
  }
  return parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim();
}

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

/** 检测模型报告未知完成原因或存在未完成 Tool Part 的情况。 */
export function detect_incomplete_response(input: {
  /** 当前 Step 结果。 */
  step_result: unknown;
  /** 当前 Step canonical Assistant Parts。 */
  assistant_parts: readonly SessionAssistantMessagePart[];
}): { reason: string; details: JsonObject } | null {
  const record = to_json_object(input.step_result) ?? {};
  const finish_reason = typeof record.finish_reason === "string"
    ? record.finish_reason
    : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const incomplete_tools = input.assistant_parts
    .filter((part): part is Extract<SessionAssistantMessagePart, { type: "tool" }> =>
      part.type === "tool" &&
      part.state !== "completed" &&
      part.state !== "failed"
    )
    .map((part) => ({ tool_name: part.tool_name, state: part.state }));
  if (incomplete_tools.length > 0) {
    return {
      reason: "incomplete_tool_part",
      details: {
        finishReason: finish_reason || null,
        incompleteToolParts: incomplete_tools,
        textPreview: to_inline_preview(text),
      },
    };
  }
  if (finish_reason !== "unknown") return null;
  return {
    reason: text ? "finish_reason_unknown" : "finish_reason_unknown_empty",
    details: {
      finishReason: finish_reason,
      textLength: text.length,
      textPreview: to_inline_preview(text),
    },
  };
}

/** 从未知值读取 JSON 对象。 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** 从 Tool 事实数组提取名称。 */
function pick_tool_names(value: unknown[]): string[] {
  return value
    .map((item) => to_json_object(item)?.tool_name)
    .filter((name): name is string => typeof name === "string")
    .slice(0, 8);
}
