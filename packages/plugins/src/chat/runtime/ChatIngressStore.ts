/**
 * ChatIngressStore：统一处理 chat 入站消息的持久化。
 *
 * 关键点（中文）
 * - `exec` 入站的审计记录写到 `chat history`
 * - 正常 turn 的 session history 落盘统一交给 `session.prompt()`
 * - 只有极少数非 turn 场景才允许显式补写 `session messages`
 */

import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";
import { appendInboundChatHistory } from "./ChatHistoryStore.js";

/**
 * 统一补齐 exec 入站的 context extra。
 *
 * 关键点（中文）
 * - `ingressKind=exec` 是模型上下文需要的最小语义标记
 * - 调用方原有 extra 保持透传
 */
export function buildExecIngressExtra(extra?: JsonObject): JsonObject {
  return {
    ...(extra && typeof extra === "object" ? extra : {}),
    ingressKind: "exec",
  };
}

/**
 * 写入完整 exec 入站记录。
 *
 * 流程（中文）
 * 1. 写 `chat history` 审计流
 * 2. 不在 ingress 边界提前写 `session messages`
 *
 * 说明（中文）
 * - 这样正常对话 history 会统一在 `session.prompt()` 内部完成落盘。
 * - 可避免 queue / control / transport 在 session 外重复持久化 user 消息。
 */
export async function appendExecIngress(params: {
  context: PluginContext;
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
}): Promise<void> {
  const execExtra = buildExecIngressExtra(params.extra);
  await appendInboundChatHistory({
    context: params.context,
    session_id: params.session_id,
    channel: params.channel,
    chatId: params.chatId,
    ingressKind: "exec",
    text: params.text,
    ...(params.targetType ? { targetType: params.targetType } : {}),
    ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    ...(params.message_id ? { message_id: params.message_id } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.actorName ? { actorName: params.actorName } : {}),
    extra: execExtra,
  });
}
