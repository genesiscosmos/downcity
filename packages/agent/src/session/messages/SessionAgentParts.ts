/**
 * canonical Agent Message Part 的共享纯函数。
 *
 * 关键点（中文）
 * - Part 变更比较与顺序号计算在 Canonical Message、运行投影和流式 Writer 中含义完全一致。
 * - 这三个规则只在本模块实现一次，避免同一表达式在多处漂移。
 */

import type { SessionAgentMessagePart } from "@downcity/type";

/** 判断两个 Part 快照是否表示同一个 canonical 版本。 */
export function is_same_agent_part(
  left: SessionAgentMessagePart | undefined,
  right: SessionAgentMessagePart,
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/** 返回相较上一稳定快照新增或载荷发生变化的 Parts。 */
export function resolve_changed_agent_parts(
  current: readonly SessionAgentMessagePart[],
  next: readonly SessionAgentMessagePart[],
): SessionAgentMessagePart[] {
  const current_by_id = new Map(
    current.map((part) => [part.part_id, part]),
  );
  return next.filter(
    (part) => !is_same_agent_part(current_by_id.get(part.part_id), part),
  );
}

/** 计算追加到 Agent Message 末尾的下一个 Part 顺序号。 */
export function next_agent_part_sequence(
  parts: readonly SessionAgentMessagePart[],
): number {
  return parts.reduce(
    (sequence, part) => Math.max(sequence, part.sequence + 1),
    1,
  );
}
