/**
 * SessionLoopSignals：tool-loop 执行循环的信号判断与调试摘要工具。
 *
 * 关键点（中文）
 * - 这里只放“如何判断继续执行 / 如何输出调试摘要”的纯函数。
 * - 不放 tool-loop 主流程，避免执行内核被大量辅助细节淹没。
 * - 目标是让 tool-loop 保持“只看主链路就能理解”的结构。
 */

import {
  getToolName,
  isTextUIPart,
  isToolUIPart,
} from "ai";
import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";
import type { JsonObject } from "@/types/common/Json.js";

/**
 * 单次 tool-loop 允许的最大 step 数。
 */
export const MAX_TOOL_LOOP_STEPS = 64;

/**
 * text-only 提醒续跑的最大次数。
 *
 * 关键点（中文）
 * - 仅用于“模型明显承诺下一步、但没有实际调用工具”的兜底。
 * - 设置较小上限，避免进入无界自催促循环。
 */
export const MAX_TEXT_ONLY_CONTINUATIONS = 3;

/**
 * 不完整响应自动恢复的最大次数。
 *
 * 关键点（中文）
 * - 仅针对 provider 流异常结束这类“本该继续、但响应被截断”的情况。
 * - 只补一次，避免在 provider 异常持续时进入长时间空转。
 */
export const MAX_INCOMPLETE_RESPONSE_RECOVERIES = 1;

/**
 * 调试日志中的文本预览最大长度。
 */
const DEBUG_TEXT_PREVIEW_MAX_CHARS = 180;

/**
 * UI tool part 中表示“尚未完成”的状态集合。
 */
const INCOMPLETE_TOOL_PART_STATES = new Set([
  "input-streaming",
  "input-available",
  "output-streaming",
]);

/**
 * 可能表示“只是描述下一步、还没真正执行”的文本模式。
 *
 * 关键点（中文）
 * - 这里故意只匹配非常明显的“我现在开始/接下来我会”类表达。
 * - 不做泛化判断，避免把正常最终答案误判为继续执行。
 */
const TEXT_ONLY_CONTINUATION_PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
}> = [
  { name: "zh_start_now", pattern: /我现在开始/ },
  { name: "zh_next_will", pattern: /接下来我会/ },
  { name: "zh_will_do", pattern: /我会(?:先|继续|开始|基于|按)/ },
  { name: "zh_after_finish", pattern: /写完.*发你|完成后.*发你/ },
  { name: "zh_fill_write", pattern: /开始(?:填充|写|补全)/ },
  { name: "zh_one_by_one", pattern: /先把.+写完整/ },
  {
    name: "en_start_now",
    pattern: /\bi(?:'m| am)?\s+(?:now\s+)?(?:starting|going to start)\b/i,
  },
  { name: "en_next_will", pattern: /\bnext,\s*i(?:'ll| will)\b/i },
  {
    name: "en_will_do",
    pattern: /\bi(?:'ll| will)\s+(?:start|continue|write|fill|complete)\b/i,
  },
  {
    name: "en_after_finish",
    pattern: /\bafter (?:that|this),?\s*i(?:'ll| will)\b/i,
  },
];

function toJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/**
 * 生成日志友好的单行预览文本。
 */
export function to_inline_preview(value: unknown): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > DEBUG_TEXT_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, DEBUG_TEXT_PREVIEW_MAX_CHARS)}...`
    : normalized;
}

function pickToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = toJsonObject(item);
      return typeof record?.toolName === "string" ? record.toolName : "";
    })
    .filter((name) => Boolean(name))
    .slice(0, 8);
}

function pickResponseMessageRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = toJsonObject(item);
      return typeof record?.role === "string" ? record.role : "";
    })
    .filter((role) => Boolean(role))
    .slice(0, 8);
}

function summarizeResponseBodyForDebug(body: unknown): JsonObject {
  const bodyRecord = toJsonObject(body);
  if (!bodyRecord) return {};

  const outputItems = Array.isArray(bodyRecord.output) ? bodyRecord.output : [];
  const outputTypes = outputItems
    .map((item) => {
      const record = toJsonObject(item);
      return typeof record?.type === "string" ? record.type : "";
    })
    .filter((type) => Boolean(type))
    .slice(0, 12);
  const functionCallNames = outputItems
    .map((item) => {
      const record = toJsonObject(item);
      if (record?.type !== "function_call") return "";
      return typeof record.name === "string" ? record.name : "";
    })
    .filter((name) => Boolean(name))
    .slice(0, 8);

  return {
    responseBodyKeys: Object.keys(bodyRecord).slice(0, 12),
    responseOutputCount: outputItems.length,
    responseOutputTypes: outputTypes,
    responseHasFunctionCall: functionCallNames.length > 0,
    responseFunctionCallNames: functionCallNames,
  };
}

/**
 * 汇总单个 step 的关键信号，便于定位“为什么没有继续下一轮”。
 */
export function summarize_step_for_debug(step_result: unknown): JsonObject {
  const record = toJsonObject(step_result) || {};
  const usage = toJsonObject(record.usage);
  const response = toJsonObject(record.response);
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  const toolResults = Array.isArray(record.toolResults) ? record.toolResults : [];
  const responseMessages = Array.isArray(response?.messages)
    ? response.messages
    : [];

  return {
    finishReason:
      typeof record.finishReason === "string" ? record.finishReason : null,
    rawFinishReason:
      typeof record.rawFinishReason === "string" ? record.rawFinishReason : null,
    textLength: typeof record.text === "string" ? record.text.length : 0,
    textPreview: to_inline_preview(record.text),
    toolCallCount: toolCalls.length,
    toolCallNames: pickToolNames(toolCalls),
    toolResultCount: toolResults.length,
    toolResultNames: pickToolNames(toolResults),
    responseMessageCount: responseMessages.length,
    responseMessageRoles: pickResponseMessageRoles(responseMessages),
    inputTokens:
      typeof usage?.inputTokens === "number" ? usage.inputTokens : null,
    outputTokens:
      typeof usage?.outputTokens === "number" ? usage.outputTokens : null,
    totalTokens:
      typeof usage?.totalTokens === "number" ? usage.totalTokens : null,
    ...summarizeResponseBodyForDebug(response?.body),
  };
}

/**
 * 汇总最终 assistant UI 消息的调试摘要。
 */
export function summarize_ui_message_for_debug(
  message: SessionMessageRecordV1 | null | undefined,
): JsonObject {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .filter(isTextUIPart)
    .map((part) => String(part.text ?? ""))
    .join("\n")
    .trim();
  const toolNames = parts
    .filter(isToolUIPart)
    .map((part) => String(getToolName(part) || ""))
    .filter((name) => Boolean(name))
    .slice(0, 8);
  const partTypes = parts
    .map((part) => {
      const record = toJsonObject(part);
      return typeof record?.type === "string" ? record.type : "unknown";
    })
    .slice(0, 12);

  return {
    role: typeof message?.role === "string" ? message.role : null,
    partCount: parts.length,
    partTypes,
    textLength: text.length,
    textPreview: to_inline_preview(text),
    toolPartCount: toolNames.length,
    toolNames,
  };
}

/**
 * 合并多轮 assistant UI 消息。
 *
 * 关键点（中文）
 * - 多 step 场景下，最终 assistant message 需要把各 step 的 UI part 串起来。
 */
export function merge_assistant_ui_messages(
  base: SessionMessageRecordV1 | null,
  incoming: SessionMessageRecordV1,
): SessionMessageRecordV1 {
  if (!base) return incoming;
  const baseMetadata = base.metadata;
  const incomingMetadata = incoming.metadata;
  return {
    ...base,
    metadata: {
      v: incomingMetadata?.v ?? baseMetadata?.v ?? 1,
      ts: incomingMetadata?.ts ?? baseMetadata?.ts ?? Date.now(),
      session_id:
        incomingMetadata?.session_id ?? baseMetadata?.session_id ?? "",
      ...(baseMetadata || {}),
      ...(incomingMetadata || {}),
    },
    parts: [
      ...(Array.isArray(base.parts) ? base.parts : []),
      ...(Array.isArray(incoming.parts) ? incoming.parts : []),
    ],
  };
}

function pickIncompleteToolParts(
  message: SessionMessageRecordV1 | null | undefined,
): Array<{
  tool_name: string;
  state: string;
}> {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter(isToolUIPart)
    .map((part) => ({
      tool_name: String(getToolName(part) || "unknown_tool"),
      state:
        typeof toJsonObject(part)?.state === "string"
          ? String(toJsonObject(part)?.state)
          : "",
    }))
    .filter((item) => INCOMPLETE_TOOL_PART_STATES.has(item.state))
    .slice(0, 8);
}

function looksLikeIncompleteText(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (normalized.endsWith("```")) return false;
  if (/[。！？.!?]$/.test(normalized)) return false;
  if (/[:：\-（(`]$/.test(normalized)) return true;
  if (/#{1,6}\s*$/.test(normalized)) return true;
  if (/^- [^\n]*$/m.test(normalized.split("\n").slice(-1)[0] || "")) return true;
  return true;
}

/**
 * 构造“不完整响应恢复”提示。
 */
export function build_incomplete_response_recovery_nudge(
  recoveryIndex: number,
): string {
  const round = Math.max(1, recoveryIndex);
  return [
    `系统恢复提醒（第 ${round} 次）：上一轮响应在流式阶段异常中断。`,
    "不要复述已完成内容。",
    "请从中断处继续；如果需要工具，请重新发起完整工具调用。",
    "只有在答案完整结束、任务真正完成、或明确受阻时才停止。",
  ].join("\n");
}

/**
 * 检测“响应被中断但模型没有正常完成”的情况。
 */
export function detect_incomplete_response(params: {
  step_result: unknown;
  assistant_message: SessionMessageRecordV1 | null | undefined;
}): {
  reason: string;
  details: JsonObject;
} | null {
  const record = toJsonObject(params.step_result) || {};
  const finishReason =
    typeof record.finishReason === "string" ? record.finishReason : "";
  const rawFinishReason =
    typeof record.rawFinishReason === "string" ? record.rawFinishReason : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  const toolResults = Array.isArray(record.toolResults) ? record.toolResults : [];
  const usage = toJsonObject(record.usage);
  const incompleteToolParts = pickIncompleteToolParts(params.assistant_message);

  if (incompleteToolParts.length > 0) {
    return {
      reason: "incomplete_tool_part",
      details: {
        finishReason: finishReason || null,
        rawFinishReason: rawFinishReason || null,
        incompleteToolParts,
        textPreview: to_inline_preview(text),
      },
    };
  }

  if (finishReason !== "other") return null;

  if (!text) {
    return {
      reason: "finish_reason_other_empty",
      details: {
        finishReason,
        rawFinishReason: rawFinishReason || null,
        toolCallCount: toolCalls.length,
        toolResultCount: toolResults.length,
      },
    };
  }

  if (looksLikeIncompleteText(text)) {
    return {
      reason: "finish_reason_other_truncated_text",
      details: {
        finishReason,
        rawFinishReason: rawFinishReason || null,
        textLength: text.length,
        textPreview: to_inline_preview(text),
        toolCallCount: toolCalls.length,
        toolResultCount: toolResults.length,
        inputTokens:
          typeof usage?.inputTokens === "number" ? usage.inputTokens : null,
        outputTokens:
          typeof usage?.outputTokens === "number" ? usage.outputTokens : null,
        totalTokens:
          typeof usage?.totalTokens === "number" ? usage.totalTokens : null,
      },
    };
  }

  return {
    reason: "finish_reason_other",
    details: {
      finishReason,
      rawFinishReason: rawFinishReason || null,
      textLength: text.length,
      textPreview: to_inline_preview(text),
    },
  };
}

/**
 * 检测“只有口头计划，没有真正执行”的续跑信号。
 */
export function detect_text_only_continuation_reason(
  step_result: unknown,
): string | null {
  const record = toJsonObject(step_result) || {};
  const finishReason =
    typeof record.finishReason === "string" ? record.finishReason : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];

  if (!text || toolCalls.length > 0) return null;
  if (finishReason && finishReason !== "stop") return null;

  for (const candidate of TEXT_ONLY_CONTINUATION_PATTERNS) {
    if (candidate.pattern.test(text)) {
      return candidate.name;
    }
  }
  return null;
}

/**
 * 构造“text-only 续跑”提示。
 */
export function build_text_only_continuation_nudge(
  continuationIndex: number,
): string {
  const round = Math.max(1, continuationIndex);
  return [
    `系统续跑提醒（第 ${round} 次）：继续执行当前任务。`,
    "不要只描述计划、下一步或“我接下来会做什么”。",
    "如果需要工具，请直接调用工具并产出实际结果。",
    "只有在任务真正完成、明确受阻、或必须等待用户提供信息时才停止。",
  ].join("\n");
}
