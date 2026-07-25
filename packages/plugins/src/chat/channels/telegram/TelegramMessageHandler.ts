/**
 * Telegram 普通消息处理器。
 *
 * 关键点（中文）
 * - 负责单条 message 的 Chat Access、审计、附件保存、入队指令构造。
 * - 不持有 channel 实例；所有副作用通过显式依赖注入。
 * - `TelegramBot` 只保留平台生命周期与命令/callback 分发入口。
 */

import path from "path";
import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type {
  IncomingChatAccessParams,
  IncomingChatAccessResult,
} from "@/chat/channels/BaseChatChannel.js";
import type { ChannelUserMessageMeta } from "@/chat/channels/BaseChatChannelSupport.js";
import {
  buildReplyContextExtra,
  buildReplyContextInstruction,
} from "@/chat/runtime/ReplyContextFormatter.js";
import {
  augmentChatInboundInput,
  buildChatInboundText,
} from "@/chat/runtime/InboundAugment.js";
import { render_chat_message_file_tag } from "@downcity/agent";
import { extractTelegramReplyContext } from "./ReplyContext.js";
import {
  getActorName,
  getTelegramChatTitle,
  type TelegramUpdate,
  type TelegramUser,
} from "./Shared.js";
import {
  buildTelegramAuditText,
  buildTelegramChatKey,
  isTelegramGroupChat,
  parseTelegramMessageId,
  saveTelegramIncomingAttachments,
  stripTelegramBotMention,
} from "./TelegramInbound.js";

/**
 * Telegram 普通消息处理所需平台能力。
 */
export interface TelegramMessagePlatform {
  /**
   * 当前 bot ID。
   */
  getBotId(): number | undefined;
  /**
   * 当前 bot 用户名。
   */
  getBotUsername(): string | undefined;
  /**
   * 发送入站轻量 ack reaction。
   */
  sendInboundAckReaction(params: {
    chatId: string;
    message_id?: number;
    emoji: string;
  }): Promise<void>;
  /**
   * 下载 Telegram 文件到本地缓存。
   */
  downloadTelegramFile(fileId: string, suggestedName?: string): Promise<string>;
}

/**
 * Audit 队列写入函数。
 */
export type TelegramMessageAuditWriter = (params: {
  chatId: string;
  message_id?: string;
  user_id?: string;
  text: string;
  meta?: ChannelUserMessageMeta;
}) => Promise<void>;

/**
 * 执行队列入队函数。
 */
export type TelegramMessageExecutor = (params: {
  chatId: string;
  instructions: string;
  from?: TelegramUser;
  chatTitle?: string;
  message_id?: string;
  chatType?: NonNullable<TelegramUpdate["message"]>["chat"]["type"];
  messageThreadId?: number;
  receivedAt?: string;
  extra?: JsonObject;
}) => Promise<void>;

/**
 * 命令分发函数。
 */
export type TelegramMessageCommandHandler = (params: {
  chatId: string;
  command: string;
  from?: TelegramUser;
  messageThreadId?: number;
}) => Promise<void>;

/**
 * Telegram message handler 依赖。
 */
export interface TelegramMessageHandlerOptions {
  /**
   * 当前 agent context。
   */
  context: PluginContext;
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * 入站 ack reaction emoji。
   */
  inboundAckEmoji: string;
  /**
   * Telegram 平台能力。
   */
  platform: TelegramMessagePlatform;
  /** 入站 Chat Access 判定。 */
  evaluateIncomingAccess(
    params: IncomingChatAccessParams,
  ): Promise<IncomingChatAccessResult>;
  /**
   * 发送 Chat Access 失败提示。
   */
  sendAccessText(params: {
    chatId: string;
    text: string;
    chatType?: string;
    messageThreadId?: number;
  }): Promise<void>;
  /**
   * 构建 Chat Access 失败提示文案。
   */
  buildAccessBlockedText(params: { result: IncomingChatAccessResult }): string;
  /**
   * Audit 队列写入。
   */
  enqueueAuditMessage: TelegramMessageAuditWriter;
  /**
   * 按 chat_key 串行执行。
   */
  runInChat(chat_key: string, fn: () => Promise<void>): Promise<void>;
  /**
   * 命令处理。
   */
  handleCommand: TelegramMessageCommandHandler;
  /**
   * 执行并回复。
   */
  executeAndReply: TelegramMessageExecutor;
}

/**
 * 处理 Telegram 普通消息。
 */
export async function handleTelegramMessage(
  options: TelegramMessageHandlerOptions,
  message: TelegramUpdate["message"],
): Promise<void> {
  if (!message || !message.chat) return;

  const chatId = message.chat.id.toString();
  const rawText =
    typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : "";
  const entities = message.entities || message.caption_entities;
  const hasIncomingAttachment = hasTelegramIncomingAttachment(message);
  const message_id =
    typeof message.message_id === "number" ? String(message.message_id) : undefined;
  const receivedAt =
    typeof message.date === "number" && Number.isFinite(message.date)
      ? new Date(message.date * 1_000).toISOString()
      : new Date().toISOString();
  const messageThreadId =
    typeof message.message_thread_id === "number"
      ? message.message_thread_id
      : undefined;
  const from = message.from;
  const botId = options.platform.getBotId();
  const botUsername = options.platform.getBotUsername();
  const fromIsBot = isTelegramBotSender({ from, botId, botUsername });
  const actorId = from?.id ? String(from.id) : undefined;
  const actorName = getActorName(from);
  const chatTitle = getTelegramChatTitle(message.chat);
  const isGroup = isTelegramGroupChat(message.chat.type);
  const chat_key = buildTelegramChatKey(chatId, messageThreadId);

  if (!actorId) {
    options.logger.warn("Telegram 消息缺少发送者 user_id，已忽略", {
      chatId,
      chatType: message.chat.type,
      message_id,
      messageThreadId,
      hasFrom: !!from,
    });
    return;
  }

  const access_result = await options.evaluateIncomingAccess({
    chatId,
    chatType: message.chat.type,
    chatTitle,
    user_id: actorId,
    username: actorName,
  });
  if (!access_result.allowed) {
    if (!isGroup) {
      await options.sendAccessText({
        chatId,
        chatType: message.chat.type,
        messageThreadId,
        text: options.buildAccessBlockedText({ result: access_result }),
      });
    }
    return;
  }

  const enqueueGroupAudit = async (params: {
    reason: string;
    kind?: string;
  }): Promise<void> => {
    if (!isGroup) return;
    await options.enqueueAuditMessage({
      chatId,
      message_id,
      user_id: actorId,
      text: buildTelegramAuditText({ rawText, hasIncomingAttachment, message }),
      meta: {
        chatType: message.chat.type,
        messageThreadId,
        username: from?.username,
        actorName,
        chatTitle,
        reason: params.reason,
        ...(params.kind ? { kind: params.kind } : {}),
        ...(fromIsBot ? { fromIsBot: true } : {}),
      },
    });
  };

  if (fromIsBot) {
    await enqueueGroupAudit({ reason: "bot_originated" });
    options.logger.debug("Ignored bot-originated message", {
      chatId,
      chatType: message.chat.type,
      message_id,
      from_id: from?.id,
      fromUsername: from?.username,
    });
    return;
  }

  await options.runInChat(chat_key, async () => {
    options.logger.debug("Telegram message received", {
      chatId,
      chatType: message.chat.type,
      isGroup,
      actorId,
      actorUsername: from?.username,
      actorName,
      message_id,
      messageThreadId,
      chat_key,
      hasIncomingAttachment,
      textPreview: rawText.length > 240 ? `${rawText.slice(0, 240)}…` : rawText,
      entityTypes: (entities || []).map((entity) => entity.type),
      botUsername,
      botId,
    });

    if (!rawText && !hasIncomingAttachment) {
      await enqueueGroupAudit({ reason: "empty_payload" });
      return;
    }

    await options.platform.sendInboundAckReaction({
      chatId,
      message_id: parseTelegramMessageId(message_id),
      emoji: options.inboundAckEmoji,
    });

    if (rawText.startsWith("/")) {
      await options.enqueueAuditMessage({
        chatId,
        message_id,
        user_id: actorId,
        text: buildTelegramAuditText({ rawText, hasIncomingAttachment, message }),
        meta: {
          chatType: message.chat.type,
          chatTitle,
          messageThreadId,
          username: from?.username,
          kind: "command",
        },
      });

      await options.handleCommand({
        chatId,
        command: rawText,
        from,
        messageThreadId,
      });
      return;
    }

    const cleaned = isGroup
      ? stripTelegramBotMention(rawText, botUsername)
      : rawText;
    if (!cleaned && !hasIncomingAttachment) {
      await enqueueGroupAudit({ reason: "empty_after_clean" });
      return;
    }

    const { attachmentLines, incomingAttachments } = await collectIncomingAttachments({
      options,
      message,
      chatId,
      message_id,
      chat_key,
    });
    const replyContext = extractTelegramReplyContext(message);

    const instructions = buildReplyContextInstruction({
      text:
        buildChatInboundText(
          await augmentChatInboundInput({
            context: options.context,
            input: {
              channel: "telegram",
              chatId,
              chatType: message.chat.type,
              chat_key,
              message_id,
              rootPath: options.rootPath,
              attachmentText:
                attachmentLines.length > 0 ? attachmentLines.join("\n") : undefined,
              body_text: cleaned ? cleaned.trim() : undefined,
              attachments: incomingAttachments.map((attachment) => ({
                channel: "telegram" as const,
                kind: attachment.type,
                path: attachment.path,
                desc: attachment.desc,
              })),
            },
          }),
        ) ||
        (attachmentLines.length > 0
          ? `${attachmentLines.join("\n")}\n\n请查看以上附件。`
          : ""),
      replyContext,
    });

    if (!instructions) return;

    await options.executeAndReply({
      chatId,
      instructions,
      from,
      chatTitle,
      message_id,
      chatType: message.chat.type,
      messageThreadId,
      receivedAt,
      extra: buildReplyContextExtra(replyContext),
    });
  });
}

/**
 * 是否有支持的入站附件。
 */
function hasTelegramIncomingAttachment(
  message: NonNullable<TelegramUpdate["message"]>,
): boolean {
  return (
    !!message.document ||
    (Array.isArray(message.photo) && message.photo.length > 0) ||
    !!message.voice ||
    !!message.audio ||
    !!message.video
  );
}

/**
 * 是否为 bot 发送者。
 */
function isTelegramBotSender(params: {
  from?: TelegramUser;
  botId?: number;
  botUsername?: string;
}): boolean {
  return (
    params.from?.is_bot === true ||
    (!!params.botId &&
      typeof params.from?.id === "number" &&
      params.from.id === params.botId) ||
    (!!params.botUsername &&
      typeof params.from?.username === "string" &&
      params.from.username.toLowerCase() === params.botUsername.toLowerCase())
  );
}

/**
 * 保存附件并转换为入站 `<file>` 标记。
 */
async function collectIncomingAttachments(params: {
  options: TelegramMessageHandlerOptions;
  message: TelegramUpdate["message"];
  chatId: string;
  message_id?: string;
  chat_key: string;
}): Promise<{
  attachmentLines: string[];
  incomingAttachments: Array<{
    type: "photo" | "document" | "voice" | "audio" | "video";
    path: string;
    desc?: string;
  }>;
}> {
  const attachmentLines: string[] = [];
  let incomingAttachments: Array<{
    type: "photo" | "document" | "voice" | "audio" | "video";
    path: string;
    desc?: string;
  }> = [];

  try {
    incomingAttachments = await saveTelegramIncomingAttachments({
      downloader: params.options.platform,
      message: params.message,
    });
    for (const attachment of incomingAttachments) {
      const rel = path.relative(params.options.rootPath, attachment.path);
      attachmentLines.push(
        render_chat_message_file_tag({
          type: attachment.type,
          path: rel,
          ...(attachment.desc ? { caption: attachment.desc } : {}),
        }),
      );
    }
  } catch (error) {
    params.options.logger.warn("Failed to save incoming Telegram attachment(s)", {
      error: String(error),
      chatId: params.chatId,
      message_id: params.message_id,
      chat_key: params.chat_key,
    });
  }

  return { attachmentLines, incomingAttachments };
}
