/**
 * canonical Agent Message Part 的共享纯函数与类型守卫。
 *
 * 关键点（中文）
 * - Part 变更比较与顺序号计算在 Canonical Message、运行投影和流式 Writer 中含义完全一致。
 * - 这三个规则只在本模块实现一次，避免同一表达式在多处漂移。
 * - 类型守卫让调用方靠运行时可校验的收窄获取具体 Part，而不是用断言跳过检查。
 */

import type { SessionAgentMessagePart } from "@downcity/type";

/** 判断一个 Part 是否属于指定类型，供调用方安全收窄。 */
export function is_agent_part_type<T extends SessionAgentMessagePart["type"]>(
  part: SessionAgentMessagePart,
  type: T,
): part is Extract<SessionAgentMessagePart, { type: T }> {
  return part.type === type;
}

/**
 * 合并同一类型两个 Part 的载荷，并保留结果身份字段。
 *
 * 只接受两个已经收窄为同一成员的具体 Part，因此“类型一致”由类型系统而非断言保证。
 */
export function merge_agent_part<T extends SessionAgentMessagePart["type"]>(
  current: Extract<SessionAgentMessagePart, { type: T }>,
  next: Extract<SessionAgentMessagePart, { type: T }>,
): Extract<SessionAgentMessagePart, { type: T }> {
  return {
    ...current,
    ...next,
    part_id: current.part_id,
    sequence: current.sequence,
    step_id: current.step_id,
  };
}

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
