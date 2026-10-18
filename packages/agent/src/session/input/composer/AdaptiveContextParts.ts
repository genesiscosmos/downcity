/**
 * 上下文 checkpoint 的纯算法部分。
 *
 * 这里没有任何存储或模型调用：调用方提供 canonical history 快照与 checkpoint，
 * 本模块只确定稳定前缀和 checkpoint 后的历史；模型语义投影与输入预算由摘要执行器负责。
 */

import type {
  SessionMessage,
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
  const stable: StableContextPart[] = [];
  for (const message of messages) {
    for (const part of [...message.parts].sort((left, right) => left.sequence - right.sequence)) {
      if (checkpoint && compare_part_position(message.sequence, part.sequence, checkpoint) <= 0) continue;
      // 未完成内容是推进屏障，不能跳过后再把 checkpoint 推到其后。
      if (part.type === "tool" && part.state !== "completed" && part.state !== "failed") return stable;
      if (part.type === "text" && message.role === "agent" && (!("state" in part) || part.state !== "done" || message.state !== "done")) return stable;
      // 是否对模型可见只由统一消息投影决定，这里仅维护稳定性与源位置。
      stable.push({ message, part });
    }
  }
  return stable;
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
