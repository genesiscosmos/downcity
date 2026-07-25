/**
 * BaseChatChannel 队列编排辅助函数。
 *
 * 关键点（中文）
 * - audit / exec 入队都需要走同一套 prepare + emit 流程。
 * - 这些逻辑抽离后，`BaseChatChannel` 只负责渠道层输入整理与 Chat Access 判断。
 */

import { resolveChatQueueStore } from "@/chat/runtime/ChatQueue.js";
import { buildQueuedUserMessageWithInfo } from "@/chat/runtime/QueuedUserMessage.js";
import { appendExecIngress } from "@/chat/runtime/ChatIngressStore.js";
import {
  emitChatEnqueueEffect,
  prepareChatEnqueue,
} from "@/chat/runtime/EnqueueDispatch.js";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { IncomingChatMessage } from "./BaseChatChannel.js";
import {
  appendInboundChannelHistory,
  resolveOrCreateChannelSessionId,
  stripUndefinedMeta,
  type ChannelUserMessageMeta,
  updateChannelChatMeta,
} from "./BaseChatChannelSupport.js";

/**
 * audit 入队输入。
 */
export interface EnqueueAuditChannelMessageParams {
  /**
   * 当前 execution runtime。
   */
  context: PluginContext;
  /**
   * 当前渠道。
   */
  channel: ChatDispatchChannel;
  /**
   * 平台 chatId。
   */
  chatId: string;
  /**
   * 文本内容。
   */
  text: string;
  /**
   * 可选消息 id。
   */
  message_id?: string;
  /**
   * 可选用户 id。
   */
  user_id?: string;
  /**
   * 可选扩展 meta。
   */
  meta?: ChannelUserMessageMeta;
}

/**
 * exec 入队输入。
 */
export interface EnqueueExecChannelMessageParams {
  /**
   * 当前 execution runtime。
   */
  context: PluginContext;
  /**
   * 当前渠道。
   */
  channel: ChatDispatchChannel;
  /**
   * 标准化后的入站消息。
   */
  message: IncomingChatMessage;
}

/**
 * 写入 audit 消息并送入 chat queue。
 */
export async function enqueueAuditChannelMessage(
  params: EnqueueAuditChannelMessageParams,
): Promise<void> {
  const meta = (params.meta || {}) as ChannelUserMessageMeta;
  const username = typeof meta.username === "string" ? meta.username : undefined;
  const messageThreadId =
    typeof meta.messageThreadId === "number" && Number.isFinite(meta.messageThreadId)
      ? meta.messageThreadId
      : undefined;
  const chatType = typeof meta.chatType === "string" ? meta.chatType : undefined;
  const chatTitle =
    typeof meta.chatTitle === "string" ? meta.chatTitle.trim() || undefined : undefined;
  const session_id = await resolveOrCreateChannelSessionId({
    context: params.context,
    channel: params.channel,
    chatId: params.chatId,
    chatType,
    messageThreadId,
  });
  if (!session_id) return;

  const extra = stripUndefinedMeta(meta);
  await appendInboundChannelHistory({
    context: params.context,
    logger: params.context.logger,
    channel: params.channel,
    session_id,
    chatId: params.chatId,
    ingressKind: "audit",
    text: params.text,
    targetType: chatType,
    threadId: messageThreadId,
    message_id: params.message_id,
    actorId: params.user_id,
    actorName: username,
    extra,
  });
  await updateChannelChatMeta({
    context: params.context,
    channel: params.channel,
    session_id,
    chatId: params.chatId,
    targetType: chatType,
    threadId: messageThreadId,
    message_id: params.message_id,
    actorId: params.user_id,
    actorName: username,
    chatTitle,
  });

  const preparedAudit = await prepareChatEnqueue({
    context: params.context,
    input: {
      kind: "audit",
      channel: params.channel,
      chat_key: session_id,
      chatId: params.chatId,
      text: params.text,
      ...(chatType ? { chatType } : {}),
      ...(typeof messageThreadId === "number" ? { threadId: messageThreadId } : {}),
      ...(typeof params.message_id === "string" ? { message_id: params.message_id } : {}),
      ...(typeof params.user_id === "string" ? { actorId: params.user_id } : {}),
      ...(typeof username === "string" ? { actorName: username } : {}),
      extra,
    },
  });
  const auditEnqueued = resolveChatQueueStore(params.context).enqueue({
    kind: "audit",
    channel: params.channel,
    targetId: params.chatId,
    session_id,
    ...(typeof preparedAudit.actorId === "string"
      ? { actorId: preparedAudit.actorId }
      : {}),
    ...(typeof preparedAudit.actorName === "string"
      ? { actorName: preparedAudit.actorName }
      : {}),
    ...(typeof preparedAudit.message_id === "string"
      ? { message_id: preparedAudit.message_id }
      : {}),
    text: preparedAudit.text,
    ...(typeof preparedAudit.threadId === "number"
      ? { threadId: preparedAudit.threadId }
      : {}),
    ...(typeof preparedAudit.chatType === "string"
      ? { targetType: preparedAudit.chatType }
      : {}),
    extra:
      preparedAudit.extra && typeof preparedAudit.extra === "object"
        ? (preparedAudit.extra as JsonObject)
        : extra,
  });
  await emitChatEnqueueEffect({
    context: params.context,
    input: {
      ...preparedAudit,
      itemId: auditEnqueued.itemId,
      lanePosition: auditEnqueued.lanePosition,
    },
  });
}

/**
 * 写入 exec ingress 并送入 chat queue。
 */
export async function enqueueExecChannelMessage(
  params: EnqueueExecChannelMessageParams,
): Promise<{ chat_key: string; position: number }> {
  const msg = params.message;
  const inboundExtra =
    msg.extra && typeof msg.extra === "object" ? stripUndefinedMeta(msg.extra) : {};
  const mergedExtra: JsonObject = { ...inboundExtra };

  const chat_key = await resolveOrCreateChannelSessionId({
    context: params.context,
    channel: params.channel,
    chatId: msg.chatId,
    chatType: msg.chatType,
    messageThreadId: msg.messageThreadId,
  });
  if (!chat_key) {
    throw new Error("Failed to resolve session_id for incoming chat message");
  }

  const rawQueuedText = buildQueuedUserMessageWithInfo({
    message_id: msg.message_id,
    user_id: msg.user_id,
    username: msg.username,
    receivedAt: msg.receivedAt,
    userTimezone: msg.userTimezone,
    text: msg.text,
  });
  const preparedExec = await prepareChatEnqueue({
    context: params.context,
    input: {
      kind: "exec",
      channel: params.channel,
      chat_key,
      chatId: msg.chatId,
      text: rawQueuedText,
      ...(msg.chatType ? { chatType: msg.chatType } : {}),
      ...(typeof msg.messageThreadId === "number"
        ? { threadId: msg.messageThreadId }
        : {}),
      ...(typeof msg.message_id === "string" ? { message_id: msg.message_id } : {}),
      ...(typeof msg.user_id === "string" ? { actorId: msg.user_id } : {}),
      ...(typeof msg.username === "string" ? { actorName: msg.username } : {}),
      extra: mergedExtra,
    },
  });
  const queuedText = preparedExec.text;
  const queuedExtra =
    preparedExec.extra && typeof preparedExec.extra === "object"
      ? (preparedExec.extra as JsonObject)
      : mergedExtra;

  await appendExecIngress({
    context: params.context,
    session_id: chat_key,
    channel: params.channel,
    chatId: msg.chatId,
    text: queuedText,
    ...(typeof preparedExec.chatType === "string"
      ? { targetType: preparedExec.chatType }
      : {}),
    ...(typeof preparedExec.threadId === "number"
      ? { threadId: preparedExec.threadId }
      : {}),
    ...(typeof preparedExec.message_id === "string"
      ? { message_id: preparedExec.message_id }
      : {}),
    ...(typeof preparedExec.actorId === "string"
      ? { actorId: preparedExec.actorId }
      : {}),
    ...(typeof preparedExec.actorName === "string"
      ? { actorName: preparedExec.actorName }
      : {}),
    extra: queuedExtra,
  });

  await updateChannelChatMeta({
    context: params.context,
    channel: params.channel,
    session_id: chat_key,
    chatId: msg.chatId,
    targetType: msg.chatType,
    threadId: msg.messageThreadId,
    message_id: msg.message_id,
    actorId: msg.user_id,
    actorName: msg.username,
    chatTitle: msg.chatTitle,
  });

  const execEnqueued = resolveChatQueueStore(params.context).enqueue({
    kind: "exec",
    channel: params.channel,
    targetId: msg.chatId,
    session_id: chat_key,
    text: queuedText,
    ...(typeof preparedExec.chatType === "string"
      ? { targetType: preparedExec.chatType }
      : {}),
    ...(typeof preparedExec.threadId === "number"
      ? { threadId: preparedExec.threadId }
      : {}),
    ...(typeof preparedExec.message_id === "string"
      ? { message_id: preparedExec.message_id }
      : {}),
    ...(typeof preparedExec.actorId === "string"
      ? { actorId: preparedExec.actorId }
      : {}),
    ...(typeof preparedExec.actorName === "string"
      ? { actorName: preparedExec.actorName }
      : {}),
    extra: queuedExtra,
  });
  await emitChatEnqueueEffect({
    context: params.context,
    input: {
      ...preparedExec,
      itemId: execEnqueued.itemId,
      lanePosition: execEnqueued.lanePosition,
    },
  });

  return { chat_key, position: execEnqueued.lanePosition };
}
