/**
 * ChatActionExecution：chat plugin runtime 的业务 action 执行模块。
 *
 * 关键点（中文）
 * - 这里只放与会话/消息相关的执行逻辑。
 * - 渠道生命周期与配置控制已拆到 `ChatChannelFacade`，避免单文件混合过多职责。
 * - 输出结构保持原有格式，确保 CLI/API 行为不变。
 */

import path from "node:path";
import type { JsonObject } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { PluginExecutionContext } from "@downcity/agent";
import type {
  ChatDeleteActionPayload,
  ChatHistoryActionPayload,
  ChatHistoryClearActionPayload,
  ChatInfoActionPayload,
  ChatListActionPayload,
  ChatReactActionPayload,
  ChatSendActionPayload,
  ChatSessionActionPayload,
} from "@/chat/types/ChatPluginActionPayload.js";
import type { ChatHistoryEventV1 } from "@/chat/types/ChatHistory.js";
import type { ChatListItemV1 } from "@/chat/types/ChatCommand.js";
import {
  deleteChatByChatKey,
  resolveChatKey,
  resolveChatSessionSnapshot,
  sendChatActionByChatKey,
  sendChatTextByChatKey,
} from "@/chat/Action.js";
import { listChannelSessionRoutes } from "@/chat/runtime/ChannelContextStore.js";
import { readChatHistory } from "@/chat/runtime/ChatHistoryStore.js";
import { readChatMetaBySessionId } from "@/chat/runtime/ChatMetaStore.js";
import { resolveChatChannelNameOrThrow } from "@/chat/runtime/ChatChannelFacade.js";
import {
  clear_chat_history,
  get_chat_channel_meta_path,
  get_chat_history_path,
  get_chat_session_dir_path,
} from "@/chat/runtime/ChatStorage.js";

/**
 * 执行 `chat.history_clear` action。
 */
export async function execute_chat_history_clear_action(params: {
  context: PluginContext;
  payload: ChatHistoryClearActionPayload;
}) {
  const session_id = String(params.payload.session_id || "").trim();
  if (!session_id) {
    return {
      success: false,
      error: "Missing session_id",
    };
  }
  const cleared = await clear_chat_history(params.context.workspace_path, session_id);
  return {
    success: true,
    data: {
      session_id: session_id,
      cleared,
    },
  };
}

function toChatHistoryView(events: ChatHistoryEventV1[]): JsonObject[] {
  return events.map((event) => ({
    ...event,
    isoTime: new Date(event.ts).toISOString(),
  })) as JsonObject[];
}

/**
 * 执行 `chat.context` action。
 */
export async function executeChatContextAction(params: {
  context: PluginContext;
  payload: ChatSessionActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const snapshot = resolveChatSessionSnapshot({
    context: params.context,
    execution_context: params.execution_context,
    ...(params.payload.chat_key ? { chat_key: params.payload.chat_key } : {}),
    ...(params.payload.session_id ? { session_id: params.payload.session_id } : {}),
  });
  return {
    success: true,
    data: {
      context: snapshot,
    },
  };
}

/**
 * 执行 `chat.list` action。
 */
export async function executeChatListAction(params: {
  context: PluginContext;
  payload: ChatListActionPayload;
}) {
  const rawChannel = String(params.payload.channel || "").trim();
  const channel = rawChannel ? resolveChatChannelNameOrThrow(rawChannel) : undefined;
  const rawLimit =
    typeof params.payload.limit === "number" && Number.isFinite(params.payload.limit)
      ? Math.trunc(params.payload.limit)
      : undefined;
  const limit = rawLimit && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
  const q = String(params.payload.q || "").trim();
  const qLower = q ? q.toLowerCase() : "";

  const meta = await listChannelSessionRoutes({ context: params.context });

  const matches = (value?: string): boolean => {
    if (!qLower) return true;
    const text = String(value || "").trim().toLowerCase();
    return text ? text.includes(qLower) : false;
  };

  const filtered = meta.routes
    .filter((route) => (channel ? route.channel === channel : true))
    .filter((route) => {
      if (!qLower) return true;
      return (
        matches(route.session_id) ||
        matches(route.chatId) ||
        matches(route.chatTitle) ||
        matches(route.actorName) ||
        matches(route.actorId) ||
        matches(route.targetType)
      );
    });

  const total = filtered.length;
  const chats: ChatListItemV1[] = filtered.slice(0, limit).map((route) => ({
    chat_key: route.session_id,
    session_id: route.session_id,
    channel: route.channel,
    chatId: route.chatId,
    ...(route.targetType ? { targetType: route.targetType } : {}),
    ...(typeof route.threadId === "number" ? { threadId: route.threadId } : {}),
    ...(route.chatTitle ? { chatTitle: route.chatTitle } : {}),
    ...(route.actorName ? { actorName: route.actorName } : {}),
    ...(route.actorId ? { actorId: route.actorId } : {}),
    updated_at: route.updated_at,
    isoUpdatedAt: new Date(route.updated_at).toISOString(),
  }));

  return {
    success: true,
    data: {
      metaUpdatedAt: meta.updated_at,
      metaIsoUpdatedAt: new Date(meta.updated_at).toISOString(),
      total,
      count: chats.length,
      chats,
    },
  };
}

/**
 * 执行 `chat.info` action。
 */
export async function executeChatInfoAction(params: {
  context: PluginContext;
  payload: ChatInfoActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const explicitSessionId = String(params.payload.session_id || "").trim();
  const explicitChatKey = String(params.payload.chat_key || "").trim();
  const snapshot = resolveChatSessionSnapshot({
    context: params.context,
    execution_context: params.execution_context,
    ...(explicitSessionId ? { session_id: explicitSessionId } : {}),
    ...(explicitChatKey ? { chat_key: explicitChatKey } : {}),
  });

  const session_id = String(explicitSessionId || snapshot.session_id || "").trim();
  const chat_key = String(explicitChatKey || snapshot.chat_key || session_id || "").trim();
  if (!session_id) {
    return {
      success: false,
      error:
        "Missing session_id. Provide --session-id/--chat-key or ensure DC_SESSION_ID/DC_CTX_CHAT_KEY is injected.",
    };
  }

  const route = await readChatMetaBySessionId({
    context: params.context,
    session_id,
  });

  const toPosixRelativePath = (absPath: string): string =>
    path.relative(params.context.workspace_path, absPath).split(path.sep).join("/");

  const channelMetaPath = toPosixRelativePath(
    get_chat_channel_meta_path(params.context.workspace_path),
  );
  const chatDirPath = toPosixRelativePath(
    get_chat_session_dir_path(params.context.workspace_path, session_id),
  );
  const historyPath = toPosixRelativePath(
    get_chat_history_path(params.context.workspace_path, session_id),
  );

  return {
    success: true,
    data: {
      session_id,
      chat_key,
      context: snapshot,
      route,
      ...(route ? { routeIsoUpdatedAt: new Date(route.updated_at).toISOString() } : {}),
      paths: {
        channelMetaPath,
        chatDirPath,
        historyPath,
      },
    },
  };
}

/**
 * 执行 `chat.history` action。
 */
export async function executeChatHistoryAction(params: {
  context: PluginContext;
  payload: ChatHistoryActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const payload = params.payload;
  const snapshot = resolveChatSessionSnapshot({
    context: params.context,
    execution_context: params.execution_context,
    ...(payload.chat_key ? { chat_key: payload.chat_key } : {}),
    ...(payload.session_id ? { session_id: payload.session_id } : {}),
  });
  const explicitSessionId = String(payload.session_id || "").trim();
  const explicitChatKey = String(payload.chat_key || "").trim();
  const session_id = String(
    explicitSessionId || explicitChatKey || snapshot.session_id || "",
  ).trim();
  if (!session_id) {
    return {
      success: false,
      error:
        "Missing session_id. Provide --session-id/--chat-key or ensure DC_SESSION_ID is injected.",
    };
  }

  const historyResult = await readChatHistory({
    context: params.context,
    session_id,
    limit: payload.limit,
    direction: payload.direction || "all",
    beforeTs: payload.beforeTs,
    afterTs: payload.afterTs,
  });
  const historyPath = historyResult.historyPath
    .replace(`${params.context.workspace_path}/`, "")
    .split("\\")
    .join("/");

  return {
    success: true,
    data: {
      context: snapshot,
      historyPath,
      count: historyResult.events.length,
      events: toChatHistoryView(historyResult.events),
    },
  };
}

/**
 * 执行 `chat.send` action。
 */
export async function executeChatSendAction(params: {
  context: PluginContext;
  payload: ChatSendActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const chat_key = resolveChatKey({
    chat_key: params.payload.chat_key,
    context: params.context,
    execution_context: params.execution_context,
  });
  if (!chat_key) {
    return {
      success: false,
      error: "Missing chat_key",
    };
  }

  const shouldScheduleInBackground =
    typeof params.payload.delay_ms === "number" ||
    typeof params.payload.send_at_ms === "number";
  const result = await sendChatTextByChatKey({
    context: params.context,
    chat_key,
    text: String(params.payload.text || ""),
    delay_ms: params.payload.delay_ms,
    send_at_ms: params.payload.send_at_ms,
    // 关键点（中文）：plugin runtime action 面向 CLI/API，定时或延迟发送应立即返回，
    // 由 runtime 在后台内存中继续等待并到点投递，避免 HTTP 请求长时间挂起。
    ...(shouldScheduleInBackground ? { nonBlockingDelay: true } : {}),
    reply_to_message: params.payload.reply_to_message === true,
    ...(typeof params.payload.message_id === "string" && params.payload.message_id.trim()
      ? { message_id: params.payload.message_id.trim() }
      : {}),
    execution_context: params.execution_context,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "chat send failed",
    };
  }
  return {
    success: true,
    data: {
      chat_key: result.chat_key || chat_key,
    },
  };
}

/**
 * 执行 `chat.react` action。
 */
export async function executeChatReactAction(params: {
  context: PluginContext;
  payload: ChatReactActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const chat_key = resolveChatKey({
    chat_key: params.payload.chat_key,
    context: params.context,
    execution_context: params.execution_context,
  });
  if (!chat_key) {
    return {
      success: false,
      error: "Missing chat_key",
    };
  }

  const message_id = String(params.payload.message_id || "").trim() || undefined;
  const result = await sendChatActionByChatKey({
    context: params.context,
    chat_key,
    action: "react",
    message_id,
    reactionEmoji: params.payload.emoji,
    reactionIsBig: params.payload.big === true,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "chat react failed",
    };
  }
  return {
    success: true,
    data: {
      chat_key: result.chat_key || chat_key,
      ...(message_id ? { message_id } : {}),
      ...(typeof params.payload.emoji === "string" && params.payload.emoji.trim()
        ? { emoji: params.payload.emoji.trim() }
        : {}),
      ...(params.payload.big === true ? { big: true } : {}),
    },
  };
}

/**
 * 执行 `chat.delete` action。
 */
export async function executeChatDeleteAction(params: {
  context: PluginContext;
  payload: ChatDeleteActionPayload;
  execution_context?: PluginExecutionContext;
}) {
  const result = await deleteChatByChatKey({
    context: params.context,
    execution_context: params.execution_context,
    ...(params.payload.chat_key ? { chat_key: params.payload.chat_key } : {}),
    ...(params.payload.session_id ? { session_id: params.payload.session_id } : {}),
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "chat delete failed",
    };
  }
  return {
    success: true,
    data: {
      session_id: result.session_id || null,
      deleted: result.deleted === true,
      removedMeta: result.removedMeta === true,
      removedChatDir: result.removedChatDir === true,
      removedSessionDir: result.removedSessionDir === true,
    },
  };
}
