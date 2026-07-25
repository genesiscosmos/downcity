/**
 * Send text to a target chat using chat_key.
 *
 * 设计动机（中文）
 * - Task runner / scheduler 需要在“非当前对话上下文”向指定 chat_key 投递消息
 * - 复用现有 dispatcher 与 chat meta（尤其 QQ 的被动回复依赖 message_id）
 *
 * 注意
 * - 这里是运行时内部能力（不是 tool）；tool `chat_contact_send` 也会复用本实现
 */

import { getChatSender } from "./ChatSendRegistry.js";
import type {
  ChatDispatchAction,
  ChatDispatchChannel,
} from "@/chat/types/ChatDispatcher.js";
import type { PluginContext } from "@downcity/agent";
import { readChatMetaBySessionId } from "./ChatMetaStore.js";

/**
 * 解析实际分发目标。
 *
 * 规则（中文）
 * - 仅使用 chat plugin runtime 维护的 session 路由映射。
 * - 不再支持 legacy chat_key 字符串解析回退。
 */
export async function resolveDispatchTargetByChatKey(params: {
  context: PluginContext;
  chat_key: string;
}): Promise<{
  channel: ChatDispatchChannel;
  chatId: string;
  chatType?: string;
  messageThreadId?: number;
  message_id?: string;
} | null> {
  const storedMeta = await readChatMetaBySessionId({
    context: params.context,
    session_id: params.chat_key,
  });
  const channel = storedMeta?.channel;
  const chatId = String(storedMeta?.chatId || "").trim();
  if (!channel || !chatId) return null;

  const chatType =
    typeof storedMeta?.targetType === "string" && storedMeta.targetType
      ? storedMeta.targetType
      : undefined;
  const messageThreadId =
    typeof storedMeta?.threadId === "number" &&
    Number.isFinite(storedMeta.threadId)
      ? storedMeta.threadId
      : undefined;
  const message_id =
    typeof storedMeta?.message_id === "string" && storedMeta.message_id
      ? storedMeta.message_id
      : undefined;

  return {
    channel: channel as ChatDispatchChannel,
    chatId,
    ...(typeof chatType === "string" && chatType ? { chatType } : {}),
    ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
    ...(typeof message_id === "string" && message_id ? { message_id } : {}),
  };
}

/**
 * 按 chat_key 发送文本到对应平台。
 *
 * 流程（中文）
 * 1) 通过 session_id 读取映射并定位 channel dispatcher
 * 2) 从 chat meta 回填 chatType/threadId/message_id
 * 3) 合并参数后调用 dispatcher 发送
 */
export async function sendTextByChatKey(params: {
  context: PluginContext;
  chat_key: string;
  text: string;
  reply_to_message?: boolean;
  message_id?: string;
}): Promise<{ success: boolean; error?: string }> {
  const context = params.context;
  const chat_key = String(params.chat_key || "").trim();
  const text = String(params.text ?? "");
  if (!chat_key) return { success: false, error: "Missing chat_key" };
  if (!text.trim()) return { success: true };

  const target = await resolveDispatchTargetByChatKey({ context, chat_key });
  if (!target) {
    return {
      success: false,
      error: `Unsupported session_id for dispatch: ${chat_key}`,
    };
  }

  const channel = target.channel;
  const chatId = target.chatId;

  const dispatcher = getChatSender(channel);
  if (!dispatcher) {
    return {
      success: false,
      error: `No dispatcher registered for channel: ${channel}`,
    };
  }

  const chatType = target.chatType;
  const messageThreadId = target.messageThreadId;
  const explicitMessageId = String(params.message_id || "").trim();
  const message_id = explicitMessageId || target.message_id;
  const shouldReplyToMessage = params.reply_to_message === true;

  if (channel === "qq") {
    if (!chatType || !message_id) {
      return {
        success: false,
        error:
          "QQ requires chatType + message_id to send a reply. Ask the target user to send a message first so Downcity can record latest chat meta.",
      };
    }
  }

  return dispatcher.sendText({
    chatId,
    text,
    ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
    ...(typeof chatType === "string" && chatType ? { chatType } : {}),
    ...(typeof message_id === "string" && message_id ? { message_id } : {}),
    ...(shouldReplyToMessage ? { reply_to_message: true } : {}),
  });
}

/**
 * 按 chat_key 发送平台动作（typing/react）。
 *
 * 流程（中文）
 * 1) 通过 session_id 读取映射并定位 channel dispatcher
 * 2) 合并目标元信息与显式参数（显式 message_id 优先）
 * 3) 调用 dispatcher.sendAction
 */
export async function sendActionByChatKey(params: {
  context: PluginContext;
  chat_key: string;
  action: ChatDispatchAction;
  message_id?: string;
  reactionEmoji?: string;
  reactionIsBig?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const context = params.context;
  const chat_key = String(params.chat_key || "").trim();
  if (!chat_key) return { success: false, error: "Missing chat_key" };
  if (!params.action) return { success: false, error: "Missing action" };

  const target = await resolveDispatchTargetByChatKey({ context, chat_key });
  if (!target) {
    return {
      success: false,
      error: `Unsupported session_id for dispatch: ${chat_key}`,
    };
  }

  const dispatcher = getChatSender(target.channel);
  if (!dispatcher || typeof dispatcher.sendAction !== "function") {
    return {
      success: false,
      error: `No action dispatcher registered for channel: ${target.channel}`,
    };
  }

  const message_id = String(params.message_id || "").trim() || target.message_id;
  return dispatcher.sendAction({
    chatId: target.chatId,
    action: params.action,
    ...(typeof target.messageThreadId === "number"
      ? { messageThreadId: target.messageThreadId }
      : {}),
    ...(typeof target.chatType === "string" && target.chatType
      ? { chatType: target.chatType }
      : {}),
    ...(typeof message_id === "string" && message_id ? { message_id } : {}),
    ...(typeof params.reactionEmoji === "string" && params.reactionEmoji.trim()
      ? { reactionEmoji: params.reactionEmoji.trim() }
      : {}),
    ...(params.reactionIsBig === true ? { reactionIsBig: true } : {}),
  });
}
