/** Renderer 对 canonical Session mutation 的纯函数投影。 */

import type { SessionMessage, SessionMutation } from "@downcity/agent";
import type { AssistantMutationDraft, IndexedSessionMutationResult, SessionMessageIndex } from "@/types/SessionProjection";

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
  return apply_indexed_session_mutations(messages, create_session_message_index(messages), mutations).messages;
}

/** 为一份 canonical 消息数组建立可跨 mutation 批次复用的位置索引。 */
export function create_session_message_index(messages: SessionMessage[]): SessionMessageIndex {
  return {
    source_messages: messages,
    positions_by_id: new Map(messages.map((message, index) => [message.message_id, index])),
  };
}

/**
 * 使用持久 message_id 索引合并一批 mutation。
 *
 * 已有消息更新只复制一次外层数组并按位置替换，不再为每个动画帧全量建表和排序；
 * 新消息使用 sequence 二分插入，并仅在数组结构变化时重建位置索引。
 */
export function apply_indexed_session_mutations(
  messages: SessionMessage[],
  message_index: SessionMessageIndex,
  mutations: SessionMutation[],
): IndexedSessionMutationResult {
  const current_index = message_index.source_messages === messages ? message_index : create_session_message_index(messages);
  if (mutations.length === 0) return { messages, message_index: current_index };
  let next_messages = messages;
  let positions_by_id = current_index.positions_by_id;
  const assistant_drafts = new Map<string, AssistantMutationDraft>();
  let changed = false;

  const ensure_messages_copy = () => {
    if (next_messages === messages) next_messages = [...messages];
  };

  for (const mutation of mutations) {
    if (mutation.variant === "message") {
      if (mutation.message.visibility !== "visible") continue;
      const current_position = positions_by_id.get(mutation.message_id);
      const current = current_position === undefined ? undefined : next_messages[current_position];
      if (current && current.revision > mutation.revision) continue;
      ensure_messages_copy();
      if (current_position === undefined) {
        const insertion_index = find_message_insertion_index(next_messages, mutation.message.sequence);
        next_messages.splice(insertion_index, 0, mutation.message);
        positions_by_id = new Map(next_messages.map((message, index) => [message.message_id, index]));
      } else {
        next_messages[current_position] = mutation.message;
      }
      assistant_drafts.delete(mutation.message_id);
      changed = true;
      continue;
    }

    if (mutation.variant !== "part" && mutation.variant !== "delta") continue;
    const message_position = positions_by_id.get(mutation.message_id);
    if (message_position === undefined) continue;
    const current = next_messages[message_position];
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
    ensure_messages_copy();
    next_messages[message_position] = draft.message;
    changed = true;
  }

  if (!changed) return { messages, message_index: current_index };
  for (const [message_id, draft] of assistant_drafts) {
    draft.parts.sort((left, right) => left.sequence - right.sequence);
    const message_position = positions_by_id.get(message_id);
    if (message_position !== undefined) next_messages[message_position] = { ...draft.message, parts: draft.parts };
  }
  return {
    messages: next_messages,
    message_index: {
      source_messages: next_messages,
      positions_by_id,
    },
  };
}

/** 按 canonical sequence 查找新消息的稳定插入位置。 */
function find_message_insertion_index(messages: SessionMessage[], sequence: number): number {
  let lower = 0;
  let upper = messages.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (messages[middle].sequence <= sequence) lower = middle + 1;
    else upper = middle;
  }
  return lower;
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
    // 相同 revision 表示同一 canonical 版本，优先保留 Renderer 现有对象以复用历史渲染分段。
    if (!candidate || message.revision >= candidate.revision) messages.set(message.message_id, message);
  }
  const merged = [...messages.values()]
    .filter((message) => message.visibility === "visible")
    .sort((left, right) => left.sequence - right.sequence);
  if (merged.length === current.length && merged.every((message, index) => message === current[index])) return current;
  return merged;
}
