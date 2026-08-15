/** Renderer 对 canonical Session mutation 的纯函数投影。 */

import type { SessionMessage, SessionMutation } from "@downcity/agent";

/**
 * 把一条 mutation 合并进当前可见消息。
 *
 * 与 Duobox 一致，revision 防止乱序事件覆盖新状态，part 和 delta 保留 SDK
 * 消息结构，Renderer 不生成第二套消息协议。
 */
export function apply_session_mutation(
  messages: SessionMessage[],
  mutation: SessionMutation,
): SessionMessage[] {
  if (mutation.variant === "message") {
    if (mutation.message.visibility !== "visible") return messages;
    const current_index = messages.findIndex((message) => message.message_id === mutation.message_id);
    if (current_index >= 0 && messages[current_index].revision > mutation.revision) return messages;
    const next_messages = [...messages];
    if (current_index >= 0) next_messages[current_index] = mutation.message;
    else next_messages.push(mutation.message);
    return next_messages.sort((left, right) => left.sequence - right.sequence);
  }

  if (mutation.variant !== "part" && mutation.variant !== "delta") return messages;
  const message_index = messages.findIndex((message) => message.message_id === mutation.message_id);
  const current = messages[message_index];
  if (!current || current.type !== "assistant" || current.revision > mutation.revision) return messages;

  const parts = [...current.parts];
  if (mutation.variant === "part") {
    const part_index = parts.findIndex((part) => part.part_id === mutation.part_id);
    if (part_index >= 0) parts[part_index] = mutation.part;
    else parts.push(mutation.part);
    parts.sort((left, right) => left.sequence - right.sequence);
  } else {
    const part_index = parts.findIndex((part) => part.part_id === mutation.part_id);
    const target = parts[part_index];
    if (!target) return messages;
    if (mutation.type === "tool_input" && target.type === "tool" && target.tool_call_id === mutation.tool_call_id) {
      parts[part_index] = { ...target, input_text: `${target.input_text ?? ""}${mutation.delta}` };
    } else if ((mutation.type === "text" || mutation.type === "reasoning") && target.type === mutation.type) {
      parts[part_index] = { ...target, text: target.text + mutation.delta };
    } else {
      return messages;
    }
  }

  const next_messages = [...messages];
  next_messages[message_index] = {
    ...current,
    revision: mutation.revision,
    updated_at: mutation.created_at,
    parts,
  };
  return next_messages;
}

/**
 * 把 IPC 快照与已经收到的实时消息按 revision 合并。
 *
 * 快照请求期间 mutation 仍可能抵达，不能用较旧快照直接覆盖 Renderer 新状态。
 */
export function merge_session_snapshot(
  current: SessionMessage[],
  snapshot: SessionMessage[],
): SessionMessage[] {
  const messages = new Map(snapshot.map((message) => [message.message_id, message]));
  for (const message of current) {
    const candidate = messages.get(message.message_id);
    if (!candidate || message.revision > candidate.revision) messages.set(message.message_id, message);
  }
  return [...messages.values()]
    .filter((message) => message.visibility === "visible")
    .sort((left, right) => left.sequence - right.sequence);
}
