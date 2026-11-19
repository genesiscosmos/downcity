/**
 * 写入检查点的稳定 Part 前缀计算。
 *
 * 仅完整 Step 或非模型 Input 的提交方可以推进水位。未终态内容阻止推进，
 * 同一 step_id 的全部 Part 是原子单元，边界不能落在其内部。
 */
import type { SessionAgentMessagePart } from "@downcity/type";
import { is_session_part_in_flight } from "./SessionMessageState.js";

/** 从已经提交的完整快照计算连续不可变前缀，不推断活动 Step 是否已结束。 */
export function resolve_stable_part_sequence(
  parts: readonly SessionAgentMessagePart[],
  previous_sequence: number,
): number {
  const ordered = [...parts].sort((left, right) => left.sequence - right.sequence);
  let candidate = ordered.at(-1)?.sequence ?? 0;
  const blocker = ordered.find(is_session_part_in_flight);
  if (blocker) candidate = ordered.filter(part => part.sequence < blocker.sequence).at(-1)?.sequence ?? 0;
  // Step 可以与 Action 等非模型 Part 穿插，因此需要按 Step 的首尾区间收缩边界。
  const intervals = new Map<string, { /** Step 首个 Part 的位置。 */ first: number; /** Step 最后 Part 的位置。 */ last: number }>();
  for (const part of ordered) {
    if (!part.step_id) continue;
    const previous = intervals.get(part.step_id);
    intervals.set(part.step_id, { first: previous?.first ?? part.sequence, last: part.sequence });
  }
  let reduced = true;
  while (reduced) {
    reduced = false;
    for (const interval of intervals.values()) {
      if (interval.first <= candidate && interval.last > candidate) {
        candidate = ordered.filter(part => part.sequence < interval.first).at(-1)?.sequence ?? 0;
        reduced = true;
      }
    }
  }
  if (candidate < previous_sequence) throw new Error("Stable Agent prefix cannot move backwards");
  return candidate;
}
