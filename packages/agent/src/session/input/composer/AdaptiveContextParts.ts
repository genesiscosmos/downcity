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
  StableContextUnit,
} from "@/types/session/ContextCheckpoint.js";
import { group_context_units, is_context_request_unit, is_context_unit_terminal } from "./ContextStableUnits.js";

/** 收集可摘要的稳定 Parts；边界选择统一由完整单元算法负责。 */
export function collect_stable_parts(
  messages: readonly SessionMessage[],
  checkpoint: ContextCheckpointRow | null,
): StableContextPart[] {
  return collect_stable_units(messages, checkpoint).flatMap(unit =>
    unit.parts.map(part => ({ message: unit.message, part })));
}

/**
 * 读取写端保证不可变的连续单元前缀，并保留最后一个请求单元。
 * streaming 消息仅允许消费 stable_part_sequence 水位内的完整单元；到达它后
 * 始终停止，不越过它读取后续消息。任何未终态内容也构成不可跨越的屏障。
 */
export function collect_stable_units(
  messages: readonly SessionMessage[],
  checkpoint: ContextCheckpointRow | null,
): StableContextUnit[] {
  const stable: StableContextUnit[] = [];
  let retained_tail: StableContextUnit | undefined;
  for (const message of messages) {
    const units = group_context_units(message);
    retained_tail = [...units].reverse().find(is_context_request_unit) ?? retained_tail;
    const streaming = message.role === "agent" && message.state !== "done";
    const watermark = streaming ? message.stable_part_sequence : Infinity;
    let blocked = false;
    for (const unit of units) {
      if (checkpoint && compare_part_position(message.sequence, unit.part.sequence, checkpoint) <= 0) continue;
      if (checkpoint && compare_part_position(message.sequence, unit.parts[0]!.sequence, checkpoint) <= 0) {
        throw new Error("Context checkpoint splits a complete Step or inbox unit");
      }
      if ((streaming && (!Number.isSafeInteger(watermark) || watermark < 0 || unit.part.sequence > watermark))
        || !is_context_unit_terminal(unit)) {
        blocked = true;
        break;
      }
      stable.push(unit);
    }
    if (streaming || blocked) break;
  }
  // 只保留一个最新原始单元，避免当前任务及最后一步在强制推进时全部变成摘要。
  if (!retained_tail) return stable;
  const tail = retained_tail;
  return stable.filter(unit => unit.message.sequence < tail.message.sequence
    || (unit.message.sequence === tail.message.sequence && unit.part.sequence < tail.parts[0]!.sequence));
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
