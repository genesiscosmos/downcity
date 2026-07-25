/**
 * Telegram 渠道门面。
 *
 * 关键点（中文）
 * - `TelegramBot` 只保留入站授权、命令分发、消息入队与回复编排。
 * - polling、runtime 状态、webhook 清理、自愈重试已下沉到 `TelegramPlatformClient`。
 * - chat_key / audit / mention 清理 / 附件保存已下沉到 `TelegramInbound`。
 */

import { BaseChatChannel } from "@/chat/channels/BaseChatChannel.js";
import type {
  ChannelChatKeyParams,
  ChannelSendActionParams,
  ChannelSendTextParams,
} from "@/chat/channels/BaseChatChannel.js";
import {
  handleTelegramCallbackQuery,
  handleTelegramCommand,
} from "./Handlers.js";
import {
  type TelegramConfig,
  type TelegramUpdate,
  type TelegramUser,
} from "./Shared.js";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import {
  buildTelegramChatKey,
  parseTelegramMessageId,
} from "./TelegramInbound.js";
import { TelegramPlatformClient } from "./TelegramPlatformClient.js";
import {
  drainTelegramPendingUpdatesToHistory,
  type TelegramPendingDrainReason,
} from "./TelegramPendingUpdates.js";
import { handleTelegramMessage } from "./TelegramMessageHandler.js";

/**
 * Telegram 平台适配器。
 */
export class TelegramBot extends BaseChatChannel {
  /**
   * 入站确认 reaction。
   */
  private static readonly INBOUND_ACK_EMOJI = "👀";

  private readonly botToken: string;
  private readonly platform: TelegramPlatformClient;
  private startTask: Promise<void> | null = null;
  private startupGeneration = 0;

  constructor(context: PluginContext, botToken: string) {
    super({ channel: "telegram", context });
    this.botToken = botToken;
    this.platform = new TelegramPlatformClient({
      context,
      botToken,
      onMessage: async (message) => {
        await this.handleMessage(message);
      },
      onCallbackQuery: async (callbackQuery) => {
        await this.handleCallbackQuery(callbackQuery);
      },
      onWebhookConflictResolved: async () => {
        await this.drainPendingUpdatesToHistory({ reason: "webhook_conflict" });
      },
    });
  }

  protected getChatKey(params: ChannelChatKeyParams): string {
    return buildTelegramChatKey(params.chatId, params.messageThreadId);
  }

  /** SDK 直连时使用 Telegram Bot ID 作为 issuer。 */
  protected getAccessIssuerFallback(): string {
    return String(this.platform.getBotId() || "").trim();
  }

  /**
   * 使用 Telegram 行内代码展示授权值。
   *
   * 说明（中文）
   * - Telegram 的 Markdown 会把普通文本中的成对下划线解析为强调标记。
   * - 行内代码可以原样保留 request ID 和 Agent ID，便于管理员直接复制执行。
   */
  protected format_access_code(value: string): string {
    const escaped_value = value.replace(/([\\`])/g, "\\$1");
    return `\`${escaped_value}\``;
  }

  /** 使用带语言标记的代码块展示可直接执行的管理命令。 */
  protected format_access_command(command: string): string {
    const escaped_command = command.replace(/([\\`])/g, "\\$1");
    return `\`\`\`bash\n${escaped_command}\n\`\`\``;
  }

  protected async sendTextToPlatform(
    params: ChannelSendTextParams,
  ): Promise<void> {
    const replyToMessageId =
      params.reply_to_message === true
        ? parseTelegramMessageId(params.message_id)
        : undefined;
    await this.sendMessage(params.chatId, params.text, {
      messageThreadId: params.messageThreadId,
      ...(typeof replyToMessageId === "number" ? { replyToMessageId } : {}),
    });
  }

  /**
   * Telegram 支持 chat action（typing / react）。
   */
  protected async sendActionToPlatform(
    params: ChannelSendActionParams,
  ): Promise<void> {
    if (params.action === "typing") {
      await this.platform.sendChatAction(params.chatId, "typing", {
        messageThreadId: params.messageThreadId,
      });
      return;
    }
    if (params.action !== "react") return;

    const message_id = parseTelegramMessageId(params.message_id);
    if (!message_id) {
      throw new Error(
        "Telegram reaction requires a numeric message_id. Provide --message-id or ensure chat meta has latest message_id.",
      );
    }
    await this.platform.setMessageReaction(params.chatId, message_id, {
      emoji: params.reactionEmoji,
      isBig: params.reactionIsBig === true,
    });
  }

  /**
   * 兼容旧的 per-chat locking 入口。
   */
  private runInChat(_chatKey: string, fn: () => Promise<void>): Promise<void> {
    return fn();
  }

  /**
   * 读取 runtime 快照。
   */
  getExecutorStatus(): {
    running: boolean;
    linkState: "connected" | "disconnected" | "unknown";
    statusText: string;
    detail: Record<string, string | number | boolean | null>;
  } {
    return this.platform.getExecutorStatus();
  }

  /**
   * 连接性测试。
   */
  async testConnection(): Promise<ChatChannelTestResult> {
    return await this.platform.testConnection();
  }

  /**
   * 启动 Telegram polling。
   */
  async start(): Promise<void> {
    if (!this.botToken) {
      this.logger.warn("Telegram Bot Token not configured, skipping startup");
      return;
    }
    if (this.startTask) return;

    this.logger.info("🤖 Starting Telegram Bot...");
    this.platform.markStartupStarted();
    const startupGeneration = ++this.startupGeneration;
    // 关键点（中文）：Telegram 网络初始化不能阻塞 Agent RPC/gateway ready。
    this.startTask = this.startInBackground(startupGeneration);
  }

  /**
   * 后台启动 Telegram polling。
   */
  private async startInBackground(startupGeneration: number): Promise<void> {
    try {
      await this.platform.preparePolling();
      await this.drainPendingUpdatesToHistory({ reason: "startup" });
      if (startupGeneration !== this.startupGeneration) {
        return;
      }
      this.platform.startPollingLoop();
      this.platform.markStartupSucceeded();
    } catch (error) {
      if (startupGeneration !== this.startupGeneration) return;
      this.platform.markStartupFailed(error);
      this.logger.error("Failed to start Telegram Bot", {
        error: String(error),
      });
      await this.platform.stop();
    } finally {
      this.startTask = null;
    }
  }

  /**
   * 把离线期间积压 updates 只入队，不执行/不回复。
   */
  private async drainPendingUpdatesToHistory(params: {
    reason: TelegramPendingDrainReason;
  }): Promise<void> {
    await drainTelegramPendingUpdatesToHistory({
      reason: params.reason,
      platform: this.platform,
      logger: this.logger,
      enqueueAuditMessage: async (message) => {
        await this.enqueueAuditMessage(message);
      },
    });
  }

  /**
   * 处理普通消息。
   */
  private async handleMessage(
    message: TelegramUpdate["message"],
  ): Promise<void> {
    await handleTelegramMessage(
      {
        context: this.context,
        rootPath: this.rootPath,
        logger: this.logger,
        inboundAckEmoji: TelegramBot.INBOUND_ACK_EMOJI,
        platform: this.platform,
        evaluateIncomingAccess: async (params) =>
          await this.evaluateIncomingAccess(params),
        sendAccessText: async (params) => {
          await this.sendAccessText(params);
        },
        buildAccessBlockedText: (params) =>
          this.buildAccessBlockedText(params),
        enqueueAuditMessage: async (params) => {
          await this.enqueueAuditMessage(params);
        },
        runInChat: async (chat_key, fn) => {
          await this.runInChat(chat_key, fn);
        },
        handleCommand: async (params) => {
          await this.handleCommand(
            params.chatId,
            params.command,
            params.from,
            params.messageThreadId,
          );
        },
        executeAndReply: async (params) => {
          await this.executeAndReply(
            params.chatId,
            params.instructions,
            params.from,
            params.chatTitle,
            params.message_id,
            params.chatType,
            params.messageThreadId,
            params.receivedAt,
            params.extra,
          );
        },
      },
      message,
    );
  }

  /**
   * 命令分发。
   */
  private async handleCommand(
    chatId: string,
    command: string,
    from?: TelegramUser,
    messageThreadId?: number,
  ): Promise<void> {
    await handleTelegramCommand(
      {
        logger: this.logger,
        sendMessage: (chatIdInput, text, opts) =>
          this.sendMessage(chatIdInput, text, opts),
        clearChat: async (chatIdInput, threadIdInput) => {
          await this.clearChatByTarget({
            chatId: chatIdInput,
            ...(typeof threadIdInput === "number"
              ? { messageThreadId: threadIdInput }
              : {}),
          });
        },
      },
      { chatId, command, from, messageThreadId },
    );
  }

  /**
   * callback_query 分发。
   */
  private async handleCallbackQuery(
    callbackQuery: TelegramUpdate["callback_query"],
  ): Promise<void> {
    await handleTelegramCallbackQuery(
      {
        logger: this.logger,
        sendMessage: (chatIdInput, text, opts) =>
          this.sendMessage(chatIdInput, text, opts),
        clearChat: async (chatIdInput, threadIdInput) => {
          await this.clearChatByTarget({
            chatId: chatIdInput,
            ...(typeof threadIdInput === "number"
              ? { messageThreadId: threadIdInput }
              : {}),
          });
        },
      },
      callbackQuery,
    );
  }

  /**
   * 执行并回复。
   */
  private async executeAndReply(
    chatId: string,
    instructions: string,
    from?: TelegramUser,
    chatTitle?: string,
    message_id?: string,
    chatType?: NonNullable<TelegramUpdate["message"]>["chat"]["type"],
    messageThreadId?: number,
    receivedAt?: string,
    extra?: JsonObject,
  ): Promise<void> {
    try {
      const user_id = from?.id ? String(from.id) : undefined;
      const username = from?.username ? String(from.username) : undefined;
      await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        message_id,
        messageThreadId,
        user_id,
        username,
        receivedAt,
        chatTitle,
        ...(extra ? { extra } : {}),
      });
    } catch (error) {
      await this.sendMessage(chatId, `❌ Execution error: ${String(error)}`, {
        messageThreadId,
      });
    }
  }

  /**
   * 发送普通消息。
   */
  async sendMessage(
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number; replyToMessageId?: number },
  ): Promise<void> {
    await this.platform.sendMessage(chatId, text, opts);
  }

  /**
   * 发送 inline keyboard。
   */
  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    await this.platform.sendMessageWithInlineKeyboard(chatId, text, buttons, opts);
  }

  /**
   * 停止 Telegram bot。
   */
  async stop(): Promise<void> {
    this.startupGeneration += 1;
    await this.platform.stop();
  }
}

/**
 * 创建 Telegram bot。
 */
export function createTelegramBot(
  config: TelegramConfig,
  context: PluginContext,
): TelegramBot | null {
  if (!config.enabled || !config.botToken || config.botToken === "${}") {
    return null;
  }
  return new TelegramBot(context, config.botToken);
}
