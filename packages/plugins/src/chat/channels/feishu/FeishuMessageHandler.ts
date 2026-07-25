/**
 * Feishu 入站消息处理器。
 *
 * 关键点（中文）
 * - 负责单条飞书消息的去重、解析、Chat Access、附件保存与执行入队。
 * - 不持有 `FeishuBot` 实例；所有副作用通过显式依赖注入。
 * - 解析失败/执行失败通过渠道门面提供的发送函数回写错误消息。
 */

import path from "path";
import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type {
  IncomingChatAccessParams,
  IncomingChatAccessResult,
} from "@/chat/channels/BaseChatChannel.js";
import type { JsonObject } from "@downcity/agent";
import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";
import {
  buildReplyContextExtra,
  buildReplyContextInstruction,
} from "@/chat/runtime/ReplyContextFormatter.js";
import {
  augmentChatInboundInput,
  buildChatInboundText,
} from "@/chat/runtime/InboundAugment.js";
import { render_chat_message_file_tag } from "@downcity/agent";
import { parseFeishuInboundMessage } from "./InboundAttachment.js";
import {
  extractFeishuSenderIdentity,
  isFeishuGroupChat,
  stripFeishuAtMentions,
} from "./FeishuInbound.js";
import type {
  FeishuDownloadedAttachment,
  FeishuMessageEvent,
  FeishuSenderIdentity,
} from "./types/FeishuChannel.js";

/**
 * Feishu message handler 依赖。
 */
export interface FeishuMessageHandlerOptions {
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
   * 构建 chat_key。
   */
  buildChatKey(chatId: string): string;
  /**
   * 已处理消息内存集合。
   */
  processedMessages: Set<string>;
  /**
   * 正在处理的消息集合。
   */
  processingMessages: Set<string>;
  /**
   * 读取持久化去重集合。
   */
  loadDedupeSet(threadId: string): Promise<Set<string>>;
  /**
   * 持久化去重集合。
   */
  persistDedupeSet(threadId: string, set: Set<string>): Promise<void>;
  /**
   * 下载入站附件。
   */
  downloadIncomingAttachments(params: {
    message_id: string;
    attachments: ReturnType<typeof parseFeishuInboundMessage>["attachments"];
  }): Promise<FeishuDownloadedAttachment[]>;
  /**
   * 解析 reply 上下文。
   */
  resolveReplyContext(params: {
    parentMessageId?: string;
  }): Promise<InboundReplyContext | undefined>;
  /**
   * 解析发送者名称。
   */
  resolveSenderName(params: {
    senderId?: string;
    idType?: "open_id" | "user_id" | "union_id";
    chatId?: string;
  }): Promise<string | undefined>;
  /**
   * 解析会话标题。
   */
  resolveChatTitle(chatId: string): Promise<string | undefined>;
  /**
   * 发送入站 ack reaction。
   */
  sendInboundAckReaction(params: { message_id: string }): Promise<void>;
  /**
   * 记录已知会话。
   */
  rememberChat(
    threadId: string,
    value: { chatId: string; chatType: string; chatTitle?: string },
  ): void;
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
   * 按 chat_key 串行执行。
   */
  runInChat(chat_key: string, fn: () => Promise<void>): Promise<void>;
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
    actorId?: string;
    actorName?: string;
    chatTitle?: string;
    extra?: JsonObject;
  }): Promise<void>;
  /**
   * 发送错误消息。
   */
  sendErrorMessage(params: {
    chatId: string;
    chatType: string;
    message_id: string;
    errorText: string;
  }): Promise<void>;
}

/**
 * 处理 Feishu 入站消息。
 */
export async function handleFeishuMessage(
  options: FeishuMessageHandlerOptions,
  data: FeishuMessageEvent,
): Promise<void> {
  try {
    if (!data?.message) return;
    const {
      message: {
        chat_id,
        content,
        message_type,
        chat_type,
        message_id,
        parent_id,
      },
    } = data;

    const threadId = options.buildChatKey(chat_id);
    const senderIdentity = extractFeishuSenderIdentity(data);
    const actorId = senderIdentity.senderId;
    const normalizedMessageId = String(message_id || "").trim();
    if (!normalizedMessageId) return;
    if (!actorId) {
      options.logger.warn("飞书消息缺少发送者 user_id/open_id，已忽略", {
        chatId: chat_id,
        chatType: chat_type,
        message_id: normalizedMessageId,
      });
      return;
    }

    if (options.processedMessages.has(normalizedMessageId)) {
      options.logger.debug(`Message already processed, skipping: ${normalizedMessageId}`);
      return;
    }

    const persisted = await options.loadDedupeSet(threadId);
    if (persisted.has(normalizedMessageId)) {
      options.logger.debug(
        `Message already processed (persisted), skipping: ${normalizedMessageId}`,
      );
      return;
    }

    if (options.processingMessages.has(normalizedMessageId)) {
      options.logger.debug(
        `Message is already being processed, skipping duplicate delivery: ${normalizedMessageId}`,
      );
      return;
    }
    options.processingMessages.add(normalizedMessageId);

    let handled = false;
    try {
      let parsedInput: {
        userMessage: string;
        incomingAttachments: FeishuDownloadedAttachment[];
        replyContext?: InboundReplyContext;
        alreadyHandled?: boolean;
      };
      try {
        parsedInput = await parseIncomingMessage({
          options,
          chatId: chat_id,
          chatType: chat_type,
          message_id: message_id,
          messageType: message_type,
          content,
          parentMessageId: parent_id,
        });
      } catch (error) {
        await options.sendErrorMessage({
          chatId: chat_id,
          chatType: chat_type,
          message_id: message_id,
          errorText: `Failed to parse message: ${String(error)}`,
        });
        handled = true;
        return;
      }
      if (parsedInput.alreadyHandled) {
        handled = true;
        return;
      }

      const handledByAuth = await handleAuthorizedMessage({
        options,
        data,
        threadId,
        senderIdentity,
        actorId,
        chatId: chat_id,
        chatType: chat_type,
        message_id: message_id,
        ...parsedInput,
      });
      handled = handledByAuth;
    } finally {
      options.processingMessages.delete(normalizedMessageId);
      if (handled) {
        options.processedMessages.add(normalizedMessageId);
        persisted.add(normalizedMessageId);
        await options.persistDedupeSet(threadId, persisted);
      }
    }
  } catch (error) {
    options.logger.error("Failed to process Feishu message", {
      error: String(error),
    });
  }
}

/**
 * 解析入站消息文本、附件和 reply 上下文。
 */
async function parseIncomingMessage(params: {
  options: FeishuMessageHandlerOptions;
  chatId: string;
  chatType: string;
  message_id: string;
  messageType: string;
  content: string;
  parentMessageId?: string;
}): Promise<{
  userMessage: string;
  incomingAttachments: FeishuDownloadedAttachment[];
  replyContext?: InboundReplyContext;
  alreadyHandled?: boolean;
}> {
  const parsed = parseFeishuInboundMessage({
    messageType: params.messageType,
    content: params.content,
  });
  if (parsed.unsupportedType) {
    await params.options.sendErrorMessage({
      chatId: params.chatId,
      chatType: params.chatType,
      message_id: params.message_id,
      errorText: `Unsupported Feishu message type: ${parsed.unsupportedType}`,
    });
    return {
      userMessage: "",
      incomingAttachments: [],
      alreadyHandled: true,
    };
  }

  return {
    userMessage: parsed.text,
    incomingAttachments: await params.options.downloadIncomingAttachments({
      message_id: params.message_id,
      attachments: parsed.attachments,
    }),
    replyContext: await params.options.resolveReplyContext({
      parentMessageId: params.parentMessageId,
    }),
  };
}

/**
 * Chat Access 通过后处理消息内容。
 */
async function handleAuthorizedMessage(params: {
  options: FeishuMessageHandlerOptions;
  data: FeishuMessageEvent;
  threadId: string;
  senderIdentity: FeishuSenderIdentity;
  actorId: string;
  chatId: string;
  chatType: string;
  message_id: string;
  userMessage: string;
  incomingAttachments: FeishuDownloadedAttachment[];
  replyContext?: InboundReplyContext;
}): Promise<boolean> {
  const {
    options,
    threadId,
    senderIdentity,
    actorId,
    chatId,
    chatType,
    message_id,
    incomingAttachments,
    replyContext,
  } = params;
  let userMessage = params.userMessage;

  options.logger.info(`Received Feishu message: ${userMessage || "[attachment]"}`);
  const actorName =
    (await options.resolveSenderName({
      ...senderIdentity,
      chatId,
    })) || undefined;
  const resolvedChatTitle = await options.resolveChatTitle(chatId);
  const chatTitle = resolvedChatTitle || (chatType === "p2p" ? actorName : undefined);

  const access_result = await options.evaluateIncomingAccess({
    chatId,
    chatType,
    chatTitle,
    user_id: actorId,
    username: actorName,
  });
  if (!access_result.allowed) {
    if (chatType === "p2p") {
      await options.sendAccessText({
        chatId,
        chatType,
        text: options.buildAccessBlockedText({ result: access_result }),
      });
    }
    return true;
  }

  options.rememberChat(threadId, {
    chatId,
    chatType,
    ...(chatTitle ? { chatTitle } : {}),
  });

  await options.sendInboundAckReaction({ message_id });

  await options.runInChat(threadId, async () => {
    if (userMessage.startsWith("/") && incomingAttachments.length === 0) {
      await options.handleCommand({
        chatId,
        chatType,
        message_id,
        command: userMessage,
      });
      return;
    }

    const attachmentLines = incomingAttachments.map((attachment) => {
      const rel = path.relative(options.rootPath, attachment.path);
      return render_chat_message_file_tag({
        type: attachment.type,
        path: rel,
        ...(attachment.desc ? { caption: attachment.desc } : {}),
      });
    });

    if (isFeishuGroupChat(chatType)) {
      userMessage = stripFeishuAtMentions(userMessage);
    }

    const instructions = buildReplyContextInstruction({
      text:
        buildChatInboundText(
          await augmentChatInboundInput({
            context: options.context,
            input: {
              channel: "feishu",
              chatId,
              chatType,
              chat_key: threadId,
              message_id,
              rootPath: options.rootPath,
              attachmentText:
                attachmentLines.length > 0 ? attachmentLines.join("\n") : undefined,
              body_text: userMessage ? userMessage.trim() : undefined,
              attachments: incomingAttachments.map((attachment) => ({
                channel: "feishu" as const,
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
      chatType,
      message_id,
      instructions,
      actorId,
      actorName,
      chatTitle,
      extra: buildReplyContextExtra(replyContext),
    });
  });
  return true;
}
