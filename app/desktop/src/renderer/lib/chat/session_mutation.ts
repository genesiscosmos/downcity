/** Renderer 对 canonical Session mutation 的纯函数投影。 */

import type { SessionMessage, SessionMutation } from "@downcity/agent";
import type { AssistantMutationDraft } from "@/types/SessionProjection";

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
  return apply_session_mutations(messages, [mutation]);
}

/**
 * 在一次批处理中合并多条 Session mutation。
 *
 * 消息索引、外层数组和每条 Assistant 的 parts 都只创建一次；处理完成后再发布
 * 一份不可变快照，避免流式 delta 在同一帧内反复扫描并复制完整会话。
 */
export function apply_session_mutations(
  messages: SessionMessage[],
  mutations: SessionMutation[],
): SessionMessage[] {
  if (mutations.length === 0) return messages;
  const messages_by_id = new Map(messages.map((message) => [message.message_id, message]));
  const assistant_drafts = new Map<string, AssistantMutationDraft>();
  let changed = false;

  for (const mutation of mutations) {
    if (mutation.variant === "message") {
      if (mutation.message.visibility !== "visible") continue;
      const current = messages_by_id.get(mutation.message_id);
      if (current && current.revision > mutation.revision) continue;
      messages_by_id.set(mutation.message_id, mutation.message);
      assistant_drafts.delete(mutation.message_id);
      changed = true;
      continue;
    }

    if (mutation.variant !== "part" && mutation.variant !== "delta") continue;
    const current = messages_by_id.get(mutation.message_id);
    if (!current || current.type !== "assistant" || current.revision > mutation.revision) continue;
    let draft = assistant_drafts.get(mutation.message_id);
    if (!draft || draft.message !== current) {
      const parts = [...current.parts];
      draft = {
        message: { ...current, parts },
        parts,
        part_indexes: new Map(parts.map((part, index) => [part.part_id, index])),
      };
      assistant_drafts.set(mutation.message_id, draft);
    }

    if (mutation.variant === "part") {
      const part_index = draft.part_indexes.get(mutation.part_id);
      if (part_index === undefined) {
        draft.part_indexes.set(mutation.part.part_id, draft.parts.length);
        draft.parts.push(mutation.part);
      } else {
        const previous_part_id = draft.parts[part_index]?.part_id;
        if (previous_part_id && previous_part_id !== mutation.part.part_id) draft.part_indexes.delete(previous_part_id);
        draft.parts[part_index] = mutation.part;
        draft.part_indexes.set(mutation.part.part_id, part_index);
      }
    } else {
      const part_index = draft.part_indexes.get(mutation.part_id);
      if (part_index === undefined) continue;
      const target = draft.parts[part_index];
      if (mutation.type === "tool_input" && target.type === "tool" && target.tool_call_id === mutation.tool_call_id) {
        draft.parts[part_index] = { ...target, input_text: `${target.input_text ?? ""}${mutation.delta}` };
      } else if ((mutation.type === "text" || mutation.type === "reasoning") && target.type === mutation.type) {
        draft.parts[part_index] = { ...target, text: target.text + mutation.delta };
      } else {
        continue;
      }
    }

    draft.message = {
      ...draft.message,
      revision: mutation.revision,
      updated_at: mutation.created_at,
      parts: draft.parts,
    };
    messages_by_id.set(mutation.message_id, draft.message);
    changed = true;
  }

  if (!changed) return messages;
  for (const [message_id, draft] of assistant_drafts) {
    draft.parts.sort((left, right) => left.sequence - right.sequence);
    messages_by_id.set(message_id, { ...draft.message, parts: draft.parts });
  }
  return [...messages_by_id.values()].sort((left, right) => left.sequence - right.sequence);
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
