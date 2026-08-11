/**
 * CoreEngine 模型上下文压缩。
 *
 * 关键点（中文）
 * - 触发条件只读取 Provider 返回的真实 usage，不做调用前 token 预估。
 * - 压缩只作用于本次运行的 ModelMessage，不修改 Session canonical Message。
 * - reasoning、tool call、tool result 与 approval 按 AI SDK 关联关系清理。
 * - 首级保留文本历史，后续深度把历史前缀折叠为 checkpoint；最后 user 与最新工具事务始终原子保留。
 * - 字符上限只用于约束已经决定压缩后的单个 part，不参与是否触发压缩的判断。
 */

import { pruneMessages, type ModelMessage } from "ai";

/** usage 达到模型上下文窗口 95% 时安排下一 step 压缩。 */
export const MODEL_CONTEXT_COMPACTION_TRIGGER_RATIO = 0.95;

/** 压缩后的真实 usage 需要回落到模型上下文窗口 50% 以内。 */
export const MODEL_CONTEXT_COMPACTION_TARGET_RATIO = 0.5;

/** 历史 checkpoint 的基础最大字符数，后续深度逐级减半。 */
const INITIAL_HISTORY_CHECKPOINT_CHARS = 24_000;

/** 单条保留消息的基础字符预算，后续深度逐级减半。 */
const INITIAL_RETAINED_MESSAGE_CHARS = 16_000;

/** 单项折叠后至少保留的字符数，避免深度压缩后完全丢失语义。 */
const MIN_FOLDED_PART_CHARS = 64;

/**
 * 读取 Provider usage 中的实际总 token。
 *
 * 优先使用 `totalTokens`；Provider 未返回时才回退为 input 与 output 之和。
 */
export function resolve_model_usage_tokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const total_tokens = read_non_negative_number(record.totalTokens);
  if (total_tokens !== null) return total_tokens;

  const input_tokens = read_non_negative_number(record.inputTokens);
  const output_tokens = read_non_negative_number(record.outputTokens);
  if (input_tokens === null && output_tokens === null) return null;
  return (input_tokens || 0) + (output_tokens || 0);
}

/** 计算真实 usage 占当前模型上下文窗口的比例。 */
export function resolve_model_usage_ratio(
  usage: unknown,
  context_window: number | undefined,
): number | null {
  if (!Number.isSafeInteger(context_window) || Number(context_window) <= 0) {
    return null;
  }
  const used_tokens = resolve_model_usage_tokens(usage);
  if (used_tokens === null) return null;
  return used_tokens / Number(context_window);
}

/**
 * 判断一次真实 usage 是否要求下一 step 继续压缩。
 *
 * 普通调用使用 95% 触发水位；刚执行过压缩的调用使用 50% 目标水位验收。
 */
export function should_compact_after_usage(
  usage_ratio: number | null,
  validating_compaction: boolean,
): boolean {
  if (usage_ratio === null || !Number.isFinite(usage_ratio)) return false;
  return validating_compaction
    ? usage_ratio > MODEL_CONTEXT_COMPACTION_TARGET_RATIO
    : usage_ratio >= MODEL_CONTEXT_COMPACTION_TRIGGER_RATIO;
}

/**
 * 对当前 ModelMessage 做一次 part 级深度压缩。
 *
 * `compact_depth` 每增加一级都会把保留预算减半，用于真实 usage 未达到目标水位时继续收紧。
 */
export function deep_compact_model_messages(
  messages: ModelMessage[],
  compact_depth = 0,
): ModelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const depth = Math.max(0, Math.min(8, Math.floor(compact_depth)));
  const pruned_messages = pruneMessages({
    messages,
    // 压缩后只保留语义内容；Provider replay 状态由 Federation 在最终路由后按作用域决定。
    reasoning: "all",
    // 工具事务由本模块按 toolCallId/approvalId 选择；先让 SDK 保留完整关联，
    // 避免 approval response 作为最后一条消息时 SDK 丢掉更早的 tool-call。
    toolCalls: "none",
    emptyMessages: "remove",
  });
  if (pruned_messages.length === 0) return [];

  const approval_to_tool_call = collect_approval_tool_call_map(pruned_messages);
  const last_user_index = find_last_message_index(
    pruned_messages,
    (message) => message.role === "user",
  );
  const selected_tool_call_ids = collect_latest_tool_transaction_ids(
    pruned_messages,
    last_user_index,
    approval_to_tool_call,
  );
  // 第一级只清理高噪声 part，保留全部文本历史；真实 usage 仍高于 50% 时，
  // 后续深度才把历史前缀折叠为 checkpoint。
  const retained_indices = depth === 0
    ? new Set(pruned_messages.map((_message, index) => index))
    : collect_retained_message_indices({
        messages: pruned_messages,
        last_user_index,
        selected_tool_call_ids,
        approval_to_tool_call,
      });
  const excluded_messages = pruned_messages.filter(
    (_message, index) => !retained_indices.has(index),
  );
  const checkpoint_limit = resolve_depth_budget(
    INITIAL_HISTORY_CHECKPOINT_CHARS,
    depth,
  );
  const checkpoint_text = build_history_checkpoint(
    excluded_messages,
    checkpoint_limit,
  );
  const message_limit = resolve_depth_budget(
    INITIAL_RETAINED_MESSAGE_CHARS,
    depth,
  );
  const retained_messages = pruned_messages
    .map((message, index) => ({ message, index }))
    .filter(({ index }) => retained_indices.has(index))
    .map(({ message }) =>
      compact_retained_message(
        message,
        message_limit,
        selected_tool_call_ids,
        approval_to_tool_call,
      ),
    )
    .filter((message): message is ModelMessage => message !== null);

  const checkpoint_message: ModelMessage[] = checkpoint_text
    ? [{ role: "assistant", content: checkpoint_text }]
    : [];
  const system_messages = retained_messages.filter(
    (message) => message.role === "system",
  );
  const non_system_messages = retained_messages.filter(
    (message) => message.role !== "system",
  );
  return remove_orphaned_tool_parts([
    ...system_messages,
    ...checkpoint_message,
    ...non_system_messages,
  ]);
}

/** 对文本做确定性的 head/tail 折叠。 */
export function fold_compacted_text(text: string, max_chars: number): string {
  const value = String(text || "");
  const limit = Math.max(MIN_FOLDED_PART_CHARS, Math.floor(max_chars));
  if (value.length <= limit) return value;
  const marker = `\n...[compacted ${String(value.length - limit)} chars]...\n`;
  const content_limit = Math.max(0, limit - marker.length);
  const head_chars = Math.ceil(content_limit / 2);
  const tail_chars = Math.floor(content_limit / 2);
  return `${value.slice(0, head_chars)}${marker}${value.slice(-tail_chars)}`;
}

function read_non_negative_number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function resolve_depth_budget(initial_budget: number, depth: number): number {
  return Math.max(
    MIN_FOLDED_PART_CHARS,
    Math.floor(initial_budget / Math.pow(2, depth)),
  );
}

function find_last_message_index(
  messages: ModelMessage[],
  predicate: (message: ModelMessage) => boolean,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

function collect_approval_tool_call_map(
  messages: ModelMessage[],
): Map<string, string> {
  const output = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "tool-approval-request") continue;
      output.set(part.approvalId, part.toolCallId);
    }
  }
  return output;
}

function collect_latest_tool_transaction_ids(
  messages: ModelMessage[],
  last_user_index: number,
  approval_to_tool_call: Map<string, string>,
): Set<string> {
  for (let index = messages.length - 1; index > last_user_index; index -= 1) {
    const message = messages[index];
    if (!Array.isArray(message.content)) continue;
    const ids = new Set<string>();
    for (const part of message.content) {
      if (part.type === "tool-call" || part.type === "tool-result") {
        ids.add(part.toolCallId);
      } else if (part.type === "tool-approval-request") {
        ids.add(part.toolCallId);
      } else if (part.type === "tool-approval-response") {
        const tool_call_id = approval_to_tool_call.get(part.approvalId);
        if (tool_call_id) ids.add(tool_call_id);
      }
    }
    if (ids.size > 0) return ids;
  }
  return new Set<string>();
}

function collect_retained_message_indices(input: {
  messages: ModelMessage[];
  last_user_index: number;
  selected_tool_call_ids: Set<string>;
  approval_to_tool_call: Map<string, string>;
}): Set<number> {
  const retained = new Set<number>();
  input.messages.forEach((message, index) => {
    if (message.role === "system") retained.add(index);
    if (index === input.last_user_index) retained.add(index);
    if (
      message_contains_selected_tool_transaction(
        message,
        input.selected_tool_call_ids,
        input.approval_to_tool_call,
      )
    ) {
      retained.add(index);
    }
  });

  if (input.selected_tool_call_ids.size === 0) {
    const last_assistant_index = find_last_message_index(
      input.messages,
      (message) => message.role === "assistant",
    );
    if (last_assistant_index > input.last_user_index) {
      retained.add(last_assistant_index);
    }
  }
  if (retained.size === 0) retained.add(input.messages.length - 1);
  return retained;
}

function message_contains_selected_tool_transaction(
  message: ModelMessage,
  selected_tool_call_ids: Set<string>,
  approval_to_tool_call: Map<string, string>,
): boolean {
  if (!Array.isArray(message.content) || selected_tool_call_ids.size === 0) {
    return false;
  }
  return message.content.some((part) => {
    if (part.type === "tool-call" || part.type === "tool-result") {
      return selected_tool_call_ids.has(part.toolCallId);
    }
    if (part.type === "tool-approval-request") {
      return selected_tool_call_ids.has(part.toolCallId);
    }
    if (part.type === "tool-approval-response") {
      const tool_call_id = approval_to_tool_call.get(part.approvalId);
      return Boolean(tool_call_id && selected_tool_call_ids.has(tool_call_id));
    }
    return false;
  });
}

function build_history_checkpoint(
  messages: ModelMessage[],
  max_chars: number,
): string {
  if (messages.length === 0) return "";
  const body = messages
    .map((message) => serialize_model_message_for_checkpoint(message))
    .filter(Boolean)
    .join("\n\n");
  if (!body) return "";
  return [
    "[Compacted conversation checkpoint]",
    fold_compacted_text(body, max_chars),
  ].join("\n");
}

function serialize_model_message_for_checkpoint(message: ModelMessage): string {
  const role = message.role;
  if (typeof message.content === "string") {
    return `${role}: ${message.content}`;
  }
  const parts = message.content.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "reasoning") return "";
    if (part.type === "tool-call") {
      return `[tool-call ${part.toolName} ${part.toolCallId}] ${safe_stringify(part.input)}`;
    }
    if (part.type === "tool-result") {
      return `[tool-result ${part.toolName} ${part.toolCallId}] ${safe_stringify(part.output)}`;
    }
    if (part.type === "tool-approval-request") {
      return `[tool-approval-request ${part.toolCallId} ${part.approvalId}]`;
    }
    if (part.type === "tool-approval-response") {
      return `[tool-approval-response ${part.approvalId} approved=${String(part.approved)}]`;
    }
    if (part.type === "file") {
      return `[file ${part.filename || "unnamed"} ${part.mediaType}]`;
    }
    if (part.type === "image") return `[image ${part.mediaType || "unknown"}]`;
    return `[${String((part as { type?: unknown }).type || "part")}]`;
  });
  return `${role}: ${parts.filter(Boolean).join("\n")}`;
}

function compact_retained_message(
  message: ModelMessage,
  message_limit: number,
  selected_tool_call_ids: Set<string>,
  approval_to_tool_call: Map<string, string>,
): ModelMessage | null {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: fold_compacted_text(message.content, message_limit),
    } as ModelMessage;
  }
  const relevant_parts = message.content.filter((part) => {
    if (part.type === "tool-call" || part.type === "tool-result") {
      return selected_tool_call_ids.has(part.toolCallId);
    }
    if (part.type === "tool-approval-request") {
      return selected_tool_call_ids.has(part.toolCallId);
    }
    if (part.type === "tool-approval-response") {
      const tool_call_id = approval_to_tool_call.get(part.approvalId);
      return Boolean(tool_call_id && selected_tool_call_ids.has(tool_call_id));
    }
    return part.type !== "reasoning";
  });
  const part_limit = Math.max(
    MIN_FOLDED_PART_CHARS,
    Math.floor(message_limit / Math.max(1, relevant_parts.length)),
  );
  const content = relevant_parts
    .map((part) =>
      compact_model_part(
        part as unknown as Record<string, unknown>,
        part_limit,
      ),
    );
  if (content.length === 0) return null;
  return { ...message, content } as ModelMessage;
}

function compact_model_part(
  part: Record<string, unknown>,
  part_limit: number,
): Record<string, unknown> {
  const semantic_part = strip_provider_replay_state(part);
  if (part.type === "text") {
    return {
      ...semantic_part,
      text: fold_compacted_text(String(part.text || ""), part_limit),
    };
  }
  if (part.type === "tool-call") {
    return {
      ...semantic_part,
      input: fold_compacted_value(part.input, part_limit),
    };
  }
  if (part.type === "tool-result") {
    const serialized_output = safe_stringify(part.output);
    if (serialized_output.length <= part_limit) return semantic_part;
    return {
      ...semantic_part,
      output: {
        type: "text",
        value: fold_compacted_text(serialized_output, part_limit),
      },
    };
  }
  if (part.type === "file") {
    const data = part.data;
    if (typeof data === "string" && data.length > part_limit) {
      return {
        type: "text",
        text: `[compacted file ${String(part.filename || "unnamed")} ${String(part.mediaType || "unknown")}, ${String(data.length)} chars]`,
      };
    }
  }
  if (part.type === "image") {
    const image = part.image;
    if (typeof image === "string" && image.length > part_limit) {
      return {
        type: "text",
        text: `[compacted image ${String(part.mediaType || "unknown")}, ${String(image.length)} chars]`,
      };
    }
  }
  return semantic_part;
}

/** 压缩后的模型 Part 只作为语义历史传递，不继续携带任何 Provider replay state。 */
function strip_provider_replay_state(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const {
    providerOptions: _provider_options,
    providerMetadata: _provider_metadata,
    ...semantic_part
  } = part;
  return semantic_part;
}

function fold_compacted_value(value: unknown, max_chars: number): unknown {
  const serialized = safe_stringify(value);
  if (serialized.length <= max_chars) return value;
  return {
    compacted: true,
    preview: fold_compacted_text(serialized, max_chars),
  };
}

function remove_orphaned_tool_parts(messages: ModelMessage[]): ModelMessage[] {
  const tool_call_ids = new Set<string>();
  const approval_ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") tool_call_ids.add(part.toolCallId);
    }
  }
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part.type === "tool-approval-request" &&
        tool_call_ids.has(part.toolCallId)
      ) approval_ids.add(part.approvalId);
    }
  }

  return messages
    .map((message) => {
      if (!Array.isArray(message.content)) return message;
      const content = message.content.filter((part) => {
        if (part.type === "tool-result") {
          return tool_call_ids.has(part.toolCallId);
        }
        if (part.type === "tool-approval-request") {
          return tool_call_ids.has(part.toolCallId);
        }
        if (part.type === "tool-approval-response") {
          return approval_ids.has(part.approvalId);
        }
        return true;
      });
      return { ...message, content } as ModelMessage;
    })
    .filter((message) => message.content.length > 0);
}

function safe_stringify(value: unknown): string {
  try {
    return JSON.stringify(value) || String(value || "");
  } catch {
    return String(value || "");
  }
}
