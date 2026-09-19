/**
 * 上下文 checkpoint 的纯算法部分。
 *
 * 这里没有任何存储或模型调用：调用方提供 canonical history 快照与 checkpoint，
 * 本模块只决定哪些 Part 值得进入摘要、边界落在哪里、以及裁剪后剩下什么。
 *
 * 关键点（中文）：Part 数量不代表上下文压力。一个巨大的 Tool/Text Part 可以独自占满
 * 窗口，因此选择使用送入摘要模型的序列化字符体积作为轻量估算。
 */

import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import type {
  ContextCheckpointRow,
  StableContextPart,
} from "@/types/session/ContextCheckpoint.js";

/** 收集 checkpoint 之后适合进入摘要的稳定 Part。 */
export function collect_stable_parts(
  messages: readonly SessionMessage[],
  checkpoint: ContextCheckpointRow | null,
): StableContextPart[] {
  return messages.flatMap((message) => message.parts.flatMap((part) => {
    if (checkpoint && compare_part_position(message.sequence, part.sequence, checkpoint) <= 0) {
      return [];
    }
    if (!is_stable_summary_part(message, part)) return [];
    return [{ message, part }];
  }));
}

/**
 * 选择足以释放约一半原始上下文体积的最旧 Part。
 *
 * 关键点（中文）：至少推进一个 Part，保证只有一个可用 Part 时仍能建立边界。
 */
export function select_compact_parts(
  candidates: readonly StableContextPart[],
): StableContextPart[] {
  if (candidates.length === 0) return [];
  const sizes = candidates.map((candidate) =>
    Math.max(candidate_to_summary_text(candidate).length, 1)
  );
  const target_size = Math.ceil(
    sizes.reduce((total, size) => total + size, 0) / 2,
  );
  let selected_size = 0;
  let selected_count = 0;
  while (selected_count < candidates.length && selected_size < target_size) {
    selected_size += sizes[selected_count] ?? 0;
    selected_count += 1;
  }
  return candidates.slice(0, Math.max(selected_count, 1));
}

/** 把单个 Part 收窄为摘要模型需要的稳定事实。 */
export function candidate_to_summary_text(candidate: StableContextPart): string {
  return JSON.stringify({
    role: candidate.message.role,
    message_id: candidate.message.message_id,
    part: summary_part(candidate.part),
  });
}

/** 删除 checkpoint 以前的 Part；边界可以位于单个 Message 内部。 */
export function slice_messages_after_checkpoint(
  messages: readonly SessionMessage[],
  checkpoint: ContextCheckpointRow,
): SessionMessage[] {
  return messages.flatMap((message): SessionMessage[] => {
    if (message.sequence < checkpoint.through_message_sequence) return [];
    if (message.sequence > checkpoint.through_message_sequence) return [message];
    const parts = message.parts.filter(
      (part) => part.sequence > checkpoint.through_part_sequence,
    );
    if (parts.length === 0) return [];
    return [{ ...message, parts } as SessionMessage];
  });
}

/** 比较 checkpoint 与候选边界，checkpoint 位于候选之前时返回负数。 */
export function compare_position(
  checkpoint: ContextCheckpointRow,
  candidate: StableContextPart,
): number {
  return -compare_part_position(
    candidate.message.sequence,
    candidate.part.sequence,
    checkpoint,
  );
}

/** 判断 Part 是否稳定且值得占据累计摘要。 */
function is_stable_summary_part(
  message: SessionMessage,
  part: SessionUserMessagePart | SessionAgentMessagePart,
): boolean {
  switch (part.type) {
    case "reasoning":
    case "action":
      return false;
    case "tool":
      return part.state === "completed" || part.state === "failed";
    case "text":
      if (message.role === "user") return true;
      return "state" in part && part.state === "done" && message.state === "done";
    case "context":
    case "file":
    case "data":
    case "error":
      return true;
    default:
      return assert_never(part);
  }
}

/** 删除瞬时字段并保留 Tool 调用/结果原子。 */
function summary_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): Record<string, unknown> {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "context":
      return { type: "context", tag: part.tag, context: part.context };
    case "file":
      return { type: "file", media_type: part.media_type, url: part.url, filename: part.filename };
    case "data":
      return { type: "data", data_type: part.data_type, data: part.data };
    case "tool":
      return {
        type: "tool",
        tool_name: part.tool_name,
        input: part.input,
        output: part.output,
        error: part.error,
      };
    case "error":
      return { type: "error", code: part.code, message: part.message };
    case "reasoning":
    case "action":
      return { type: part.type };
    default:
      return assert_never(part);
  }
}

/** 比较 canonical Part 与 checkpoint 的全局线性位置。 */
function compare_part_position(
  message_sequence: number,
  part_sequence: number,
  checkpoint: ContextCheckpointRow,
): number {
  if (message_sequence !== checkpoint.through_message_sequence) {
    return message_sequence - checkpoint.through_message_sequence;
  }
  return part_sequence - checkpoint.through_part_sequence;
}

/** canonical Part 联合类型新增成员时强制摘要算法显式选择语义。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported summary Session Part: ${String((value as { type?: unknown }).type)}`);
}
