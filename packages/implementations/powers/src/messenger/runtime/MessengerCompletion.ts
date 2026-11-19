/**
 * Channel Turn 完成后的唯一自动回复入口。
 *
 * SDK 的持久化完成事件驱动本模块。路由与 Outbox 在同一事务提交，按完成事件和
 * Conversation 去重。后台续轮通过 caller_turn_id 找回原请求，绝不使用最新入站消息。
 */
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import type { MessengerStore } from "@/messenger/storage/MessengerStore.js";
import type { MessengerConversationRecord, MessengerInboxRecord } from "@/messenger/types/MessengerReliability.js";

/** 将一个匹配 Channel 会话的完成事件可靠提交到 Messenger Outbox。 */
export function commit_messenger_completion(
  store: MessengerStore,
  agent_id: string,
  event: SessionTurnCommittedHookValue,
): void {
  const conversation = store.get_conversation_by_session(event.session_id);
  if (!conversation || conversation.agent_id !== agent_id || conversation.status !== "active") return;
  const inbound_ids = resolve_inbound_ids(store, agent_id, event);
  const inbound = inbound_ids.map((id) => {
    const record = store.get_inbound(id);
    if (!record || record.conversation_id !== conversation.conversation_id) {
      throw new Error(`Messenger completion source does not belong to this conversation: ${id}`);
    }
    return record;
  });
  // 同一目的地只回一条；并入同轮的多个请求用最早的输入作为引用，保留全部来源记录。
  const first = inbound[0];
  const text = event.status === "completed" ? event.result.text
    : event.status === "failed" ? "本次任务执行失败，请稍后重试或查看会话详情。" : "";
  store.transaction(() => {
    store.completion_routes.save(agent_id, event.session_id, event.turn_id, inbound_ids);
    if (text.trim()) {
      store.insert_outbound({
        delivery_id: `delivery:${event.completion_id}:${conversation.conversation_id}`,
        account_id: conversation.account_id,
        conversation_id: conversation.conversation_id,
        operation: "text",
        payload: completion_payload(conversation, first, text),
      });
    }
  });
}

/** 收集本轮直接入站与运行时输入的因果来源；后台续轮通过来源 Turn 关联已提交路由。 */
function resolve_inbound_ids(
  store: MessengerStore,
  agent_id: string,
  event: SessionTurnCommittedHookValue,
): string[] {
  const ids = new Set<string>();
  const caller_turn_ids = new Set<string>();
  for (const message of event.messages) {
    if (message.origin) continue;
    if (message.role === "user") {
      for (const part of message.parts) {
        if (part.type !== "context" || part.tag !== "messenger_request") continue;
        const value = JSON.parse(part.context) as { /** Inbox 中由宿主生成的稳定标识。 */ inbound_id?: string };
        if (value.inbound_id) ids.add(value.inbound_id);
      }
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== "input") continue;
      const caller_turn_id = part.source?.turn_id;
      if (part.kind === "delegation_result" || part.kind === "session_background") {
        if (!caller_turn_id) throw new Error("Delegated Channel output is missing its caller Turn route");
      }
      if (caller_turn_id && caller_turn_id !== event.turn_id) caller_turn_ids.add(caller_turn_id);
    }
  }
  for (const caller_turn_id of caller_turn_ids) {
    const source_ids = store.completion_routes.get(agent_id, event.session_id, caller_turn_id);
    if (source_ids === null) throw new Error(`Caller Turn route is not committed yet: ${caller_turn_id}`);
    for (const id of source_ids) ids.add(id);
  }
  return [...ids];
}

/** 路由取自已经持久化并核对归属的 Inbox，原消息不在时使用 Conversation 固定路由。 */
function completion_payload(
  conversation: MessengerConversationRecord,
  inbound: MessengerInboxRecord | undefined,
  text: string,
): Record<string, unknown> {
  return {
    text,
    chat_id: conversation.external_chat_id,
    chat_type: conversation.chat_type,
    ...(inbound ? { message_id: inbound.message.external_message_id } : {}),
    ...(conversation.thread_id ? { thread_id: conversation.thread_id } : {}),
  };
}
