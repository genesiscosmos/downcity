/**
 * ChatHistory 类型定义。
 *
 * 关键点（中文）
 * - chat history 是聊天平台事件流（审计向），与 session message history 分离。
 * - 支持入站（inbound）与出站（outbound）事件，便于完整回放对话链路。
 */

import type { JsonObject } from "@downcity/agent";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

export type ChatHistoryIngressKind = "audit" | "exec";
export type ChatHistoryDirection = "inbound" | "outbound";

type ChatHistoryBaseEventV1 = {
  v: 1;
  id: string;
  ts: number;
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
};

export type ChatHistoryInboundEventV1 = ChatHistoryBaseEventV1 & {
  direction: "inbound";
  ingressKind: ChatHistoryIngressKind;
};

export type ChatHistoryOutboundEventV1 = ChatHistoryBaseEventV1 & {
  direction: "outbound";
};

export type ChatHistoryEventV1 =
  | ChatHistoryInboundEventV1
  | ChatHistoryOutboundEventV1;
