/**
 * CoreEngine Downcity 模型上下文压缩模块。
 *
 * 压缩基于标准 ModelMessage，保留 system、最新 user 及其后的完整工具事务。
 */

import type { ModelContent, ModelMessage } from "@downcity/type";

/** usage 达到模型上下文窗口 95% 时安排下一 step 压缩。 */
export const MODEL_CONTEXT_COMPACTION_TRIGGER_RATIO = 0.95;
/** 压缩后的真实 usage 需要回落到模型上下文窗口 50% 以内。 */
export const MODEL_CONTEXT_COMPACTION_TARGET_RATIO = 0.5;
/** 历史 checkpoint 的基础最大字符数。 */
const INITIAL_HISTORY_CHECKPOINT_CHARS = 24_000;
/** 单条保留消息的基础字符预算。 */
const INITIAL_RETAINED_MESSAGE_CHARS = 16_000;
/** 折叠后至少保留的字符数。 */
const MIN_FOLDED_PART_CHARS = 64;

/** 读取 Provider usage 中的实际总 token。 */
export function resolve_model_usage_tokens(usage: unknown): number | null {
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
export function resolve_model_usage_ratio(
  usage: unknown,
  context_window: number | undefined,
): number | null {
  if (!Number.isSafeInteger(context_window) || Number(context_window) <= 0) return null;
  const used_tokens = resolve_model_usage_tokens(usage);
  return used_tokens === null ? null : used_tokens / Number(context_window);
}

/** 判断一次真实 usage 是否要求下一 step 继续压缩。 */
export function should_compact_after_usage(
  usage_ratio: number | null,
  validating_compaction: boolean,
): boolean {
  if (usage_ratio === null || !Number.isFinite(usage_ratio)) return false;
  return validating_compaction
    ? usage_ratio > MODEL_CONTEXT_COMPACTION_TARGET_RATIO
    : usage_ratio >= MODEL_CONTEXT_COMPACTION_TRIGGER_RATIO;
}

/** 对当前模型消息做一次确定性深度压缩。 */
export function deep_compact_model_messages(
  messages: ModelMessage[],
  compact_depth = 0,
): ModelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const depth = Math.max(0, Math.min(8, Math.floor(compact_depth)));
  const last_user_index = find_last_user_index(messages);
  if (depth === 0) {
    const limit = resolve_depth_budget(INITIAL_RETAINED_MESSAGE_CHARS, depth);
    return messages.flatMap((message, index) => {
      const compacted = compact_message(message, limit, index >= last_user_index);
      return compacted ? [compacted] : [];
    });
  }
  const system_messages = messages.filter((message) => message.role === "system");
  const retained_start = last_user_index >= 0 ? last_user_index : Math.max(0, messages.length - 2);
  const history = messages.filter((message, index) => message.role !== "system" && index < retained_start);
  const retained = messages.filter((message, index) => message.role !== "system" && index >= retained_start);
  const checkpoint = build_checkpoint(
    history,
    resolve_depth_budget(INITIAL_HISTORY_CHECKPOINT_CHARS, depth),
  );
  const limit = resolve_depth_budget(INITIAL_RETAINED_MESSAGE_CHARS, depth);
  return [
    ...system_messages.flatMap((message) => {
      const compacted = compact_message(message, limit, false);
      return compacted ? [compacted] : [];
    }),
    ...(checkpoint ? [{ role: "assistant", content: [{ type: "text", text: checkpoint }] } as ModelMessage] : []),
    ...retained.flatMap((message) => {
      const compacted = compact_message(message, limit, true);
      return compacted ? [compacted] : [];
    }),
  ];
}

/** 对文本做确定性的 head/tail 折叠。 */
export function fold_compacted_text(text: string, max_chars: number): string {
  const value = String(text || "");
  const limit = Math.max(MIN_FOLDED_PART_CHARS, Math.floor(max_chars));
  if (value.length <= limit) return value;
  const marker = `\n...[compacted ${String(value.length - limit)} chars]...\n`;
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available / 2);
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`;
}

/** 压缩单条消息中的高体积内容。 */
function compact_message(
  message: ModelMessage,
  max_chars: number,
  keep_tools: boolean,
): ModelMessage | undefined {
  const part_limit = Math.max(MIN_FOLDED_PART_CHARS, Math.floor(max_chars / Math.max(1, message.content.length)));
  const content = message.content.flatMap<ModelContent>((part) => {
      // 推理过程不属于压缩后仍需保留的稳定事实。
      if (part.type === "reasoning") return [];
      if (part.type === "text") {
        return [{ ...part, text: fold_compacted_text(part.text, part_limit) }];
      }
      if (part.type === "tool_call" && !keep_tools) return [];
      if (part.type === "tool_result") {
        if (!keep_tools) return [];
        return [{
          ...part,
          content: part.content.map((result_part) => {
            if (result_part.type === "text") {
              return {
                ...result_part,
                text: fold_compacted_text(result_part.text, part_limit),
              };
            }
            if (result_part.type !== "json") return result_part;
            const serialized = JSON.stringify(result_part.value);
            if (serialized.length <= part_limit) return result_part;
            return {
              type: "json" as const,
              value: {
                compacted: true,
                preview: fold_compacted_text(serialized, part_limit),
              },
            };
          }),
        }];
      }
      return [part];
    });
  if (content.length === 0) return undefined;
  return { ...message, content };
}

/** 生成历史 checkpoint 文本。 */
function build_checkpoint(messages: ModelMessage[], max_chars: number): string {
  const text = messages.map((message) => {
    const content = message.content.map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "reasoning") return "";
      if (part.type === "file") return `[file ${part.media_type}${part.filename ? ` ${part.filename}` : ""}]`;
      if (part.type === "tool_call") return `[tool_call ${part.tool_name}]`;
      return `[tool_result ${part.tool_name} ${part.outcome}]`;
    }).join("\n");
    return `${message.role}: ${content}`;
  }).join("\n\n");
  return text ? `Earlier conversation checkpoint:\n${fold_compacted_text(text, max_chars)}` : "";
}

/** 查找最新用户消息索引。 */
function find_last_user_index(messages: ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

/** 按压缩深度计算当前字符预算。 */
function resolve_depth_budget(initial_budget: number, depth: number): number {
  return Math.max(MIN_FOLDED_PART_CHARS, Math.floor(initial_budget / (2 ** depth)));
}

/** 读取非负数字。 */
function read_non_negative_number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
