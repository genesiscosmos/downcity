/**
 * ChatMetaStore：按 session_id 维护 chat 路由元信息。
 *
 * 关键点（中文）
 * - 入站消息到达时由 chat plugin runtime 写入
 * - 出站按 session_id/chat_key 发送时由 chat plugin runtime 读取
 * - 底层数据落在 `.downcity/channel/meta.json`，由 ChannelContextStore 统一维护
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatMetaV1 } from "@/chat/types/ChatMeta.js";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";
import {
  removeChannelSessionRouteBySessionId,
  readChannelSessionRouteBySessionId,
  resolveChannelSessionIdByTarget,
  resolveOrCreateChannelSessionIdByTarget,
  upsertChannelSessionRouteBySessionId,
} from "./ChannelContextStore.js";

function normalizeSessionId(session_id: string): string {
  return String(session_id || "").trim();
}

function normalizeChatId(chatId: string): string {
  return String(chatId || "").trim();
}

/**
 * 读取指定 session_id 的 chat meta。
 */
export async function readChatMetaBySessionId(params: {
  context: PluginContext;
  session_id: string;
}): Promise<ChatMetaV1 | null> {
  const session_id = normalizeSessionId(params.session_id);
  if (!session_id) return null;
  const route = await readChannelSessionRouteBySessionId({
    context: params.context,
    session_id,
  });
  if (!route) return null;
  return {
    v: 1,
    updated_at: route.updated_at,
    session_id: route.session_id,
    channel: route.channel,
    chatId: route.chatId,
    ...(route.targetType ? { targetType: route.targetType } : {}),
    ...(typeof route.threadId === "number" ? { threadId: route.threadId } : {}),
    ...(route.message_id ? { message_id: route.message_id } : {}),
    ...(route.actorId ? { actorId: route.actorId } : {}),
    ...(route.actorName ? { actorName: route.actorName } : {}),
    ...(route.chatTitle ? { chatTitle: route.chatTitle } : {}),
  };
}

/**
 * 更新指定 session_id 的 chat meta（全量覆盖最近快照）。
 */
export async function upsertChatMetaBySessionId(params: {
  context: PluginContext;
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  chatTitle?: string;
}): Promise<void> {
  const session_id = normalizeSessionId(params.session_id);
  const chatId = normalizeChatId(params.chatId);
  if (!session_id || !chatId) return;
  await upsertChannelSessionRouteBySessionId({
    context: params.context,
    session_id,
    target: {
      channel: params.channel,
      chatId,
      ...(typeof params.targetType === "string" ? { targetType: params.targetType } : {}),
      ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    },
    message_id: params.message_id,
    actorId: params.actorId,
    actorName: params.actorName,
    chatTitle: params.chatTitle,
  });
}

/**
 * 通过渠道目标查找已有 session_id。
 */
export async function resolveSessionIdByChatTarget(params: {
  context: PluginContext;
  channel: ChatDispatchChannel;
  chatId: string;
  targetType?: string;
  threadId?: number;
}): Promise<string | null> {
  const chatId = normalizeChatId(params.chatId);
  if (!chatId) return null;
  return await resolveChannelSessionIdByTarget({
    context: params.context,
    target: {
      channel: params.channel,
      chatId,
      ...(typeof params.targetType === "string" ? { targetType: params.targetType } : {}),
      ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    },
  });
}

/**
 * 通过渠道目标解析或创建 session_id。
 */
export async function resolveOrCreateSessionIdByChatTarget(params: {
  context: PluginContext;
  channel: ChatDispatchChannel;
  chatId: string;
  targetType?: string;
  threadId?: number;
}): Promise<string | null> {
  const chatId = normalizeChatId(params.chatId);
  if (!chatId) return null;
  return await resolveOrCreateChannelSessionIdByTarget({
    context: params.context,
    target: {
      channel: params.channel,
      chatId,
      ...(typeof params.targetType === "string" ? { targetType: params.targetType } : {}),
      ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    },
  });
}

/**
 * 删除指定 session_id 的 chat meta 映射。
 *
 * 关键点（中文）
 * - 删除后该 session_id 不再可用于 chat_key 路由发送。
 * - 若同一 target 重新收到入站消息，会创建新的 session_id。
 */
export async function removeChatMetaBySessionId(params: {
  context: PluginContext;
  session_id: string;
}): Promise<{
  removed: boolean;
  route: ChatMetaV1 | null;
}> {
  const session_id = normalizeSessionId(params.session_id);
  if (!session_id) {
    return {
      removed: false,
      route: null,
    };
  }
  const result = await removeChannelSessionRouteBySessionId({
    context: params.context,
    session_id,
  });
  const route = result.route;
  if (!route) {
    return {
      removed: false,
      route: null,
    };
  }
  return {
    removed: result.removed,
    route: {
      v: 1,
      updated_at: route.updated_at,
      session_id: route.session_id,
      channel: route.channel,
      chatId: route.chatId,
      ...(route.targetType ? { targetType: route.targetType } : {}),
      ...(typeof route.threadId === "number" ? { threadId: route.threadId } : {}),
      ...(route.message_id ? { message_id: route.message_id } : {}),
      ...(route.actorId ? { actorId: route.actorId } : {}),
      ...(route.actorName ? { actorName: route.actorName } : {}),
      ...(route.chatTitle ? { chatTitle: route.chatTitle } : {}),
    },
  };
}
