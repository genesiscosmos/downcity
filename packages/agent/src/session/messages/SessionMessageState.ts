/**
 * Session Message 展示状态的推导规则。
 *
 * Message 不保存「是否还能写」这个事实：它由 writer 持有关系与自身 Parts 共同决定。
 * 本模块是唯一规则源，任何写入方都不得自行决定 Message 终态。
 */

import type {
  SessionAgentMessage,
  SessionAgentMessagePart,
} from "@downcity/type";

/** 判断 Part 是否仍在进行中。 */
export function is_session_part_in_flight(part: SessionAgentMessagePart): boolean {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.state === "streaming";
    case "tool":
      return part.state !== "completed" && part.state !== "failed";
    case "action":
      return part.state === "running";
    case "file":
    case "data":
    case "error":
      return false;
  }
}

/**
 * 推导 Message 的展示状态。
 *
 * 被未收口的 writer 持有 ⇒ 仍可写；否则只要有进行中的 Part 就可写。
 * 进行中的 Action 会让其载体 Message 保持 streaming，完成后立即收敛为 done。
 */
export function resolve_session_message_state(
  parts: readonly SessionAgentMessagePart[],
  held_by_writer: boolean,
): SessionAgentMessage["state"] {
  if (held_by_writer) return "streaming";
  return parts.some(is_session_part_in_flight) ? "streaming" : "done";
}
