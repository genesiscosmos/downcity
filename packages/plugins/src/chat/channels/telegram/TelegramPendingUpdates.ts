/**
 * Telegram 积压 updates 补录逻辑。
 *
 * 关键点（中文）
 * - 只负责把 polling 启动前/冲突恢复后的积压 update 写入 audit history。
 * - 不执行 agent、不发送回复，避免离线消息在重连时集中触发执行。
 * - `TelegramBot` 只传入平台能力与队列写入能力，保持门面轻量。
 */

import type { Logger } from "@downcity/agent";
import type { ChannelUserMessageMeta } from "@/chat/channels/BaseChatChannelSupport.js";
import {
  getTelegramChatTitle,
  type TelegramUpdate,
} from "./Shared.js";
import {
  buildTelegramAuditText,
  buildTelegramChatKey,
  isTelegramGroupChat,
} from "./TelegramInbound.js";

/**
 * 积压 update 补录原因。
 */
export type TelegramPendingDrainReason = "startup" | "webhook_conflict";

/**
 * 积压 update 补录所需平台能力。
 */
export interface TelegramPendingUpdatePlatform {
  /**
   * 拉取积压 updates，并逐条交给调用方处理。
   */
  drainPendingUpdates(params: {
    reason: TelegramPendingDrainReason;
    handleUpdate: (update: TelegramUpdate) => Promise<void>;
  }): Promise<number>;
  /**
   * 当前 bot ID，用于识别 bot 自己发送的私聊消息。
   */
  getBotId(): number | undefined;
  /**
   * 当前 bot 用户名，用于识别 bot 自己发送的私聊消息。
   */
  getBotUsername(): string | undefined;
}

/**
 * Audit 队列写入函数。
 */
export type TelegramPendingAuditWriter = (params: {
  chatId: string;
  message_id?: string;
  user_id?: string;
  text: string;
  meta?: ChannelUserMessageMeta;
}) => Promise<void>;

/**
 * 补录 Telegram 积压 updates 到 audit history。
 */
export async function drainTelegramPendingUpdatesToHistory(params: {
  reason: TelegramPendingDrainReason;
  platform: TelegramPendingUpdatePlatform;
  logger: Logger;
  enqueueAuditMessage: TelegramPendingAuditWriter;
}): Promise<void> {
  const drained = await params.platform.drainPendingUpdates({
    reason: params.reason,
    handleUpdate: async (update) => {
      await enqueuePendingUpdate({
        update,
        reason: params.reason,
        platform: params.platform,
        enqueueAuditMessage: params.enqueueAuditMessage,
      });
    },
  });

  if (drained > 0) {
    params.logger.info(`Drained ${drained} pending Telegram updates to queue`, {
      reason: params.reason,
    });
  }
}

/**
 * 单条 update 的 audit 写入分发。
 */
async function enqueuePendingUpdate(params: {
  update: TelegramUpdate;
  reason: TelegramPendingDrainReason;
  platform: TelegramPendingUpdatePlatform;
  enqueueAuditMessage: TelegramPendingAuditWriter;
}): Promise<void> {
  if (params.update.message?.chat?.id) {
    await enqueuePendingMessage(params);
    return;
  }

  if (params.update.callback_query?.from?.id) {
    await enqueuePendingCallbackQuery(params);
  }
}

/**
 * 补录普通 message。
 */
async function enqueuePendingMessage(params: {
  update: TelegramUpdate;
  reason: TelegramPendingDrainReason;
  platform: TelegramPendingUpdatePlatform;
  enqueueAuditMessage: TelegramPendingAuditWriter;
}): Promise<void> {
  const message = params.update.message;
  if (!message?.chat?.id) return;

  const chatId = message.chat.id.toString();
  const messageThreadId =
    typeof message.message_thread_id === "number"
      ? message.message_thread_id
      : undefined;
  const chat_key = buildTelegramChatKey(chatId, messageThreadId);
  const from = message.from;
  const chatTitle = getTelegramChatTitle(message.chat);
  const botId = params.platform.getBotId();
  const botUsername = params.platform.getBotUsername();
  const fromIsBot =
    from?.is_bot === true ||
    (!!botId && typeof from?.id === "number" && from.id === botId) ||
    (!!botUsername &&
      typeof from?.username === "string" &&
      from.username.toLowerCase() === botUsername.toLowerCase());
  const isGroup = isTelegramGroupChat(message.chat.type);
  if (fromIsBot && !isGroup) return;

  const rawText =
    typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : "";
  const hasIncomingAttachment =
    !!message.document ||
    (Array.isArray(message.photo) && message.photo.length > 0) ||
    !!message.voice ||
    !!message.audio ||
    !!message.video;

  const message_id =
    typeof message.message_id === "number" ? String(message.message_id) : undefined;
  const actorId = from?.id ? String(from.id) : undefined;

  await params.enqueueAuditMessage({
    chatId,
    message_id,
    user_id: actorId,
    text: buildTelegramAuditText({ rawText, hasIncomingAttachment, message }),
    meta: {
      kind: "pending",
      pendingReason: params.reason,
      updateId: params.update.update_id,
      chatType: message.chat.type,
      chatTitle,
      messageThreadId,
      username: from?.username,
      fromIsBot,
      chat_key,
    },
  });
}

/**
 * 补录 callback_query。
 */
async function enqueuePendingCallbackQuery(params: {
  update: TelegramUpdate;
  reason: TelegramPendingDrainReason;
  enqueueAuditMessage: TelegramPendingAuditWriter;
}): Promise<void> {
  const query = params.update.callback_query;
  if (!query?.from?.id) return;

  const chatId = query.message?.chat?.id?.toString?.() || "";
  if (!chatId) return;

  const messageThreadId =
    typeof query.message?.message_thread_id === "number"
      ? query.message.message_thread_id
      : undefined;
  await params.enqueueAuditMessage({
    chatId,
    message_id: undefined,
    user_id: query.from?.id ? String(query.from.id) : undefined,
    text: `[callback_query] ${String(query.data || "").slice(0, 1000)}`.trim(),
    meta: {
      kind: "pending",
      pendingReason: params.reason,
      updateId: params.update.update_id,
      messageThreadId,
      username: query.from?.username,
    },
  });
}
