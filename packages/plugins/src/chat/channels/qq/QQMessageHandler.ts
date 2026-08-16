/**
 * QQ 入站消息处理器。
 *
 * 关键点（中文）
 * - 负责 group / c2c / channel 三类入站消息的 Chat Access、去重、审计与执行入队。
 * - 不直接持有 `QQBot` 实例；所有副作用通过显式函数注入。
 * - `QQBot` 因此只保留渠道生命周期、dispatch 分流、发送与命令处理。
 */

import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type {
  ChannelChatKeyParams,
  IncomingChatAccessParams,
  IncomingChatAccessResult,
} from "@/chat/channels/BaseChatChannel.js";
import type { ChannelUserMessageMeta } from "@/chat/channels/BaseChatChannelSupport.js";
import {
  buildQqAuditText,
  extractQqAuthorIdentity,
  extractQqInboundAttachments,
  extractQqTextContent,
  resolveQqInboundChatTitle,
  stripQqBotMention,
} from "./QQInbound.js";
import {
  buildQqInboundInstructions,
  resolveQqC2cChatId,
  resolveQqGroupChatId,
} from "./QQSupport.js";
import type { QQMessageData } from "./types/QqChannel.js";
import { EventType } from "./types/QqChannel.js";

/**
 * QQ 消息作者身份。
 */
export type QqMessageActor = {
  /**
   * QQ 用户 ID / openid。
   */
  user_id?: string;
  /**
   * QQ 用户展示名。
   */
  username?: string;
};

/**
 * QQ 入站消息处理依赖。
 */
export interface QQMessageHandlerOptions {
  /**
   * 当前 agent context。
   */
  context: PluginContext;
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 当前 AgentWorkspace 的私有数据目录。
   */
  dataPath: string;
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * 当前 bot 用户 ID。
   */
  getBotUserId(): string;
  /**
   * 计算 channel chat_key。
   */
  getChatKey(params: ChannelChatKeyParams): string;
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
  }): Promise<void>;
  /**
   * 构建 Chat Access 失败提示文案。
   */
  buildAccessBlockedText(params: { result: IncomingChatAccessResult }): string;
  /**
   * 入站去重判断。
   */
  shouldSkipDuplicatedInboundMessage(
    eventType: string,
    message_id: string | undefined,
  ): Promise<boolean>;
  /**
   * Audit 队列写入。
   */
  enqueueAuditMessage(params: {
    chatId: string;
    message_id?: string;
    user_id?: string;
    text: string;
    meta?: ChannelUserMessageMeta;
  }): Promise<void>;
  /**
   * 命令处理。
   */
  handleCommand(params: {
    chatId: string;
    chatType: string;
    message_id: string;
    command: string;
  }): Promise<void>;
  /**
   * 执行入队。
   */
  executeAndReply(params: {
    chatId: string;
    chatType: string;
    message_id: string;
    instructions: string;
    actor?: QqMessageActor;
    chatTitle?: string;
  }): Promise<void>;
  /**
   * QQ access token 获取函数，用于入站附件下载。
   */
  getAuthToken(): Promise<string>;
}

/**
 * 处理群聊消息。
 */
export async function handleQqGroupMessage(
  options: QQMessageHandlerOptions,
  params: {
    eventType: string;
    data: QQMessageData;
  },
): Promise<void> {
  const eventType = String(params.eventType || "").trim();
  const data = params.data;
  const message_id =
    typeof data.id === "string" ? data.id.trim() : String(data.id || "").trim();
  if (!message_id) return;

  const groupId = resolveQqGroupChatId(data);
  if (!groupId) {
    options.logger.warn("QQ 群消息缺少 groupId，已忽略", {
      eventType: eventType || EventType.GROUP_MESSAGE_CREATE,
      message_id,
    });
    return;
  }

  await handleQqInboundMessage(options, {
    eventType: eventType || EventType.GROUP_MESSAGE_CREATE,
    chatId: groupId,
    chatType: "group",
    data,
  });
}

/**
 * 处理 C2C 私聊消息。
 */
export async function handleQqC2CMessage(
  options: QQMessageHandlerOptions,
  data: QQMessageData,
): Promise<void> {
  const message_id =
    typeof data.id === "string" ? data.id.trim() : String(data.id || "").trim();
  if (!message_id) return;

  const actor = extractQqAuthorIdentity(data.author, data);
  const chatId = resolveQqC2cChatId({
    data,
    actor_user_id: actor.user_id,
  });
  if (!chatId) {
    options.logger.warn("QQ C2C 消息缺少 user_id，已忽略", {
      eventType: EventType.C2C_MESSAGE_CREATE,
      message_id,
    });
    return;
  }

  await handleQqInboundMessage(options, {
    eventType: EventType.C2C_MESSAGE_CREATE,
    chatId,
    chatType: "c2c",
    data,
    actor,
  });
}

/**
 * 处理频道消息。
 */
export async function handleQqChannelMessage(
  options: QQMessageHandlerOptions,
  data: QQMessageData,
): Promise<void> {
  const { id: message_id, channel_id: channelId, content, author } = data;
  if (!channelId || !message_id) return;
  const chatType = "channel";
  if (
    await options.shouldSkipDuplicatedInboundMessage(
      EventType.AT_MESSAGE_CREATE,
      message_id,
    )
  ) {
    return;
  }

  const userMessage = extractQqTextContent(String(content || ""));
  const incomingAttachments = extractQqInboundAttachments(data);
  const actor = extractQqAuthorIdentity(author, data);
  const chatTitle = resolveQqInboundChatTitle({
    chatType,
    data,
    actorName: actor.username,
  });

  const access_result = await options.evaluateIncomingAccess({
    chatId: channelId,
    chatType,
    chatTitle,
    user_id: actor.user_id,
    username: actor.username,
  });
  if (!access_result.allowed) return;

  const botUserId = options.getBotUserId();
  if (actor.user_id && botUserId && actor.user_id === botUserId) {
    options.logger.debug("忽略机器人自身消息（channel）", {
      message_id,
      channelId,
      botUserId,
    });
    return;
  }

  options.logger.info(`收到频道消息 [${channelId}]: ${userMessage}`);

  if (userMessage.startsWith("/")) {
    await options.handleCommand({
      chatId: channelId,
      chatType: "channel",
      message_id,
      command: userMessage,
    });
    return;
  }

  const instructions = await buildQqInboundInstructions({
    context: options.context,
    rootPath: options.rootPath,
    dataPath: options.dataPath,
    chatId: channelId,
    chat_key: options.getChatKey({ chatId: channelId, chatType }),
    message_id,
    userMessage,
    attachments: incomingAttachments,
    getAuthToken: () => options.getAuthToken(),
  });
  if (!instructions) return;

  await options.executeAndReply({
    chatId: channelId,
    chatType: "channel",
    message_id,
    instructions,
    actor,
    chatTitle,
  });
}

/**
 * QQ group / c2c 入站主流程。
 */
async function handleQqInboundMessage(
  options: QQMessageHandlerOptions,
  params: {
    eventType: string;
    chatId: string;
    chatType: "group" | "c2c";
    data: QQMessageData;
    actor?: QqMessageActor;
  },
): Promise<void> {
  const eventType = String(params.eventType || "").trim();
  const chatId = String(params.chatId || "").trim();
  const message_id =
    typeof params.data.id === "string"
      ? params.data.id.trim()
      : String(params.data.id || "").trim();
  if (!chatId || !message_id) return;

  if (await options.shouldSkipDuplicatedInboundMessage(eventType, message_id)) {
    return;
  }

  const actor = params.actor || extractQqAuthorIdentity(params.data.author, params.data);
  const chatType = params.chatType;
  if (!actor.user_id) {
    options.logger.warn("QQ 入站消息缺少发送者 user_id，已忽略", {
      eventType,
      chatId,
      chatType,
      message_id,
    });
    return;
  }

  const chatTitle = resolveQqInboundChatTitle({
    chatType,
    data: params.data,
    actorName: actor.username,
  });
  const isGroup = chatType === "group";
  const chat_key = options.getChatKey({ chatId, chatType });
  const rawContent = String(params.data.content || "");
  const incomingAttachments = extractQqInboundAttachments(params.data);
  const hasIncomingAttachment = incomingAttachments.length > 0;
  const botUserId = options.getBotUserId();
  const cleanedText = isGroup
    ? stripQqBotMention(rawContent, botUserId)
    : extractQqTextContent(rawContent);

  const access_result = await options.evaluateIncomingAccess({
    chatId,
    chatType,
    chatTitle,
    user_id: actor.user_id,
    username: actor.username,
  });
  if (!access_result.allowed) {
    if (!isGroup) {
      await options.sendAccessText({
        chatId,
        chatType,
        text: options.buildAccessBlockedText({ result: access_result }),
      });
    }
    return;
  }

  const enqueueAudit = async (opts: { reason: string; kind?: string }): Promise<void> => {
    await options.enqueueAuditMessage({
      chatId,
      message_id,
      user_id: actor.user_id,
      text: buildQqAuditText({
        rawContent,
        cleanedText,
        hasIncomingAttachment,
      }),
      meta: {
        chatType,
        username: actor.username,
        chatTitle,
        eventType,
        reason: opts.reason,
        ...(opts.kind ? { kind: opts.kind } : {}),
      },
    });
  };

  if (actor.user_id && botUserId && actor.user_id === botUserId) {
    if (isGroup) {
      await enqueueAudit({ reason: "bot_originated" });
    }
    options.logger.debug("忽略机器人自身消息", {
      message_id,
      chatId,
      chatType,
      botUserId,
    });
    return;
  }

  options.logger.info(`收到 ${chatType} 消息 [${chatId}]: ${cleanedText}`);

  if (!rawContent && !hasIncomingAttachment) {
    if (isGroup) {
      await enqueueAudit({ reason: "empty_payload" });
    }
    return;
  }

  if (cleanedText.startsWith("/")) {
    await enqueueAudit({
      reason: "command_received",
      kind: "command",
    });
    await options.handleCommand({
      chatId,
      chatType,
      message_id,
      command: cleanedText,
    });
    return;
  }

  if (!cleanedText && !hasIncomingAttachment) {
    await enqueueAudit({ reason: "empty_after_clean" });
    return;
  }

  const instructions = await buildQqInboundInstructions({
    context: options.context,
    rootPath: options.rootPath,
    dataPath: options.dataPath,
    chatId,
    chat_key,
    message_id,
    userMessage: cleanedText,
    attachments: incomingAttachments,
    getAuthToken: () => options.getAuthToken(),
  });
  if (!instructions) {
    await enqueueAudit({ reason: "empty_after_build" });
    return;
  }

  await options.executeAndReply({
    chatId,
    chatType,
    message_id,
    instructions,
    actor,
    chatTitle,
  });
}
