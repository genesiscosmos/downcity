/**
 * TelegramPlatformClient：Telegram 平台运行时与 API 门面。
 *
 * 关键点（中文）
 * - 负责 polling、webhook 清理、自愈重试、Bot 信息获取、runtime 状态输出。
 * - 同时统一封装 Telegram API client 的消息发送与附件下载能力。
 * - `TelegramBot` 只保留入站授权、命令分发、消息入队等业务编排。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import { TelegramApiClient } from "./ApiClient.js";
import { TelegramStateStore } from "./StateStore.js";
import type {
  TelegramConfig,
  TelegramUpdate,
} from "./Shared.js";

/**
 * Telegram 平台 client 构造参数。
 */
export interface TelegramPlatformClientOptions {
  /**
   * 当前执行上下文。
   */
  context: PluginContext;
  /**
   * Telegram bot token。
   */
  botToken: string;
  /**
   * 普通消息回调。
   */
  onMessage: (message: TelegramUpdate["message"]) => Promise<void>;
  /**
   * callback_query 回调。
   */
  onCallbackQuery: (
    callbackQuery: TelegramUpdate["callback_query"],
  ) => Promise<void>;
  /**
   * webhook 冲突自愈后的补偿回调。
   */
  onWebhookConflictResolved?: () => Promise<void>;
}

/**
 * Telegram 平台运行时。
 */
export class TelegramPlatformClient {
  private readonly logger: PluginContext["logger"];
  private readonly api: TelegramApiClient;
  private readonly stateStore: TelegramStateStore;
  private readonly onMessage: TelegramPlatformClientOptions["onMessage"];
  private readonly onCallbackQuery: TelegramPlatformClientOptions["onCallbackQuery"];
  private readonly onWebhookConflictResolved?: TelegramPlatformClientOptions["onWebhookConflictResolved"];

  private readonly botToken: string;
  private lastUpdateId = 0;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private pollInFlight = false;
  private lastDrainAttemptAt = 0;
  private consecutivePollErrors = 0;
  private nextPollAllowedAt = 0;
  private botUsername?: string;
  private botId?: number;
  private clearedWebhookOnce = false;
  private isStarting = false;
  private lastStartupError: string | null = null;

  constructor(options: TelegramPlatformClientOptions) {
    this.logger = options.context.logger;
    this.botToken = options.botToken;
    this.api = new TelegramApiClient({
      botToken: options.botToken,
      project_root: options.context.workspace_path,
      logger: options.context.logger,
    });
    this.stateStore = new TelegramStateStore(options.context.workspace_path);
    this.onMessage = options.onMessage;
    this.onCallbackQuery = options.onCallbackQuery;
    this.onWebhookConflictResolved = options.onWebhookConflictResolved;
  }

  /**
   * 返回只读 runtime 快照。
   */
  getExecutorStatus(): {
    running: boolean;
    linkState: "connected" | "disconnected" | "unknown";
    statusText: string;
    detail: Record<string, string | number | boolean | null>;
  } {
    const running = this.isRunning;
    const linkState =
      running && (typeof this.botId === "number" || !!this.botUsername)
        ? "connected"
        : running
          ? "unknown"
          : "disconnected";
    const statusText = this.lastStartupError
      ? "start_failed"
      : this.isStarting
        ? "starting"
        : linkState === "connected"
          ? "polling"
          : linkState === "unknown"
            ? "starting"
            : "stopped";
    return {
      running,
      linkState,
      statusText,
      detail: {
        isStarting: this.isStarting,
        pollInFlight: this.pollInFlight,
        lastUpdateId: this.lastUpdateId,
        consecutivePollErrors: this.consecutivePollErrors,
        nextPollAllowedAt: this.nextPollAllowedAt || null,
        botUsername: this.botUsername || null,
        botId: typeof this.botId === "number" ? this.botId : null,
        lastStartupError: this.lastStartupError,
      },
    };
  }

  /**
   * 标记 Telegram 后台启动开始。
   */
  markStartupStarted(): void {
    this.isStarting = true;
    this.isRunning = true;
    this.lastStartupError = null;
  }

  /**
   * 标记 Telegram 后台启动完成。
   */
  markStartupSucceeded(): void {
    this.isStarting = false;
    this.lastStartupError = null;
  }

  /**
   * 标记 Telegram 后台启动失败。
   */
  markStartupFailed(error: unknown): void {
    this.isStarting = false;
    this.isRunning = false;
    this.lastStartupError = String(error);
  }

  /**
   * 获取 bot 用户名。
   */
  getBotUsername(): string | undefined {
    return this.botUsername;
  }

  /**
   * 获取 bot ID。
   */
  getBotId(): number | undefined {
    return this.botId;
  }

  /**
   * 连接性测试。
   */
  async testConnection(): Promise<ChatChannelTestResult> {
    const startedAt = Date.now();
    if (!this.botToken) {
      return {
        channel: "telegram",
        success: false,
        testedAtMs: startedAt,
        message: "Bot token is missing",
      };
    }
    try {
      const me = await this.api.requestJson<{ id?: number; username?: string }>(
        "getMe",
        {},
      );
      const now = Date.now();
      return {
        channel: "telegram",
        success: true,
        testedAtMs: now,
        latencyMs: now - startedAt,
        message: `Connected as @${String(me.username || "unknown")}`,
        detail: {
          botId: typeof me.id === "number" ? me.id : null,
          botUsername: me.username || null,
        },
      };
    } catch (error) {
      const now = Date.now();
      return {
        channel: "telegram",
        success: false,
        testedAtMs: now,
        latencyMs: now - startedAt,
        message: `Telegram API check failed: ${String(error)}`,
      };
    }
  }

  /**
   * 启动 polling 前的准备阶段。
   */
  async preparePolling(): Promise<void> {
    this.isRunning = true;
    const lastUpdateId = await this.stateStore.loadLastUpdateId();
    if (typeof lastUpdateId === "number" && lastUpdateId > 0) {
      this.lastUpdateId = lastUpdateId;
    }

    try {
      await this.api.requestJson<boolean>("deleteWebhook", {
        drop_pending_updates: false,
      });
      this.clearedWebhookOnce = true;
      this.logger.info("Telegram webhook cleared (polling mode)");
    } catch (error) {
      this.logger.warn("Failed to clear Telegram webhook (continuing)", {
        error: String(error),
      });
    }

    const me = await this.api.requestJson<{ id?: number; username?: string }>(
      "getMe",
      {},
    );
    this.botUsername = me.username || undefined;
    this.botId = typeof me.id === "number" ? me.id : undefined;
    this.logger.info(`Bot username: @${me.username || "unknown"}`);
  }

  /**
   * 启动轮询循环。
   */
  startPollingLoop(): void {
    this.consecutivePollErrors = 0;
    this.nextPollAllowedAt = 0;
    this.pollingInterval = setInterval(() => {
      void this.pollUpdates();
    }, 1000);
    this.logger.info("Telegram Bot started");
  }

  /**
   * 拉取当前积压 updates 并交给外部 handler 处理。
   */
  async drainPendingUpdates(params: {
    reason: "startup" | "webhook_conflict";
    handleUpdate: (update: TelegramUpdate) => Promise<void>;
  }): Promise<number> {
    const now = Date.now();
    if (now - this.lastDrainAttemptAt < 30_000) return 0;
    this.lastDrainAttemptAt = now;

    let drained = 0;
    try {
      for (let i = 0; i < 50; i++) {
        const updates = await this.api.requestJson<TelegramUpdate[]>(
          "getUpdates",
          {
            offset: this.lastUpdateId + 1,
            limit: 100,
            timeout: 0,
          },
        );
        if (!Array.isArray(updates) || updates.length === 0) break;

        for (const update of updates) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          await params.handleUpdate(update);
        }

        drained += updates.length;
      }

      await this.stateStore.saveLastUpdateId(this.lastUpdateId);
      return drained;
    } catch (error) {
      this.logger.warn("Failed to drain pending Telegram updates to queue", {
        error: String(error),
        reason: params.reason,
      });
      return drained;
    }
  }

  /**
   * 入站轻量 ack reaction。
   */
  async sendInboundAckReaction(params: {
    chatId: string;
    message_id?: number;
    emoji: string;
  }): Promise<void> {
    if (!params.message_id) return;
    try {
      await this.api.setMessageReaction(params.chatId, params.message_id, {
        emoji: params.emoji,
      });
    } catch (error) {
      this.logger.warn("Telegram 入站 ack reaction 失败，继续处理消息", {
        chatId: params.chatId,
        message_id: params.message_id,
        error: String(error),
      });
    }
  }

  /**
   * 发送文本消息。
   */
  async sendMessage(
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number; replyToMessageId?: number },
  ): Promise<void> {
    await this.api.sendMessage(chatId, text, opts);
  }

  /**
   * 发送 inline keyboard 消息。
   */
  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    await this.api.sendMessageWithInlineKeyboard(chatId, text, buttons, opts);
  }

  /**
   * 发送 chat action。
   */
  async sendChatAction(
    chatId: string,
    action: "typing",
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    await this.api.sendChatAction(chatId, action, opts);
  }

  /**
   * 设置消息 reaction。
   */
  async setMessageReaction(
    chatId: string,
    message_id: number,
    opts?: { emoji?: string; isBig?: boolean },
  ): Promise<void> {
    await this.api.setMessageReaction(chatId, message_id, opts);
  }

  /**
   * 下载 Telegram 文件。
   */
  async downloadTelegramFile(
    fileId: string,
    suggestedName?: string,
  ): Promise<string> {
    return await this.api.downloadTelegramFile(fileId, suggestedName);
  }

  /**
   * 停止平台运行时。
   */
  async stop(): Promise<void> {
    this.isStarting = false;
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.consecutivePollErrors = 0;
    this.nextPollAllowedAt = 0;
    this.logger.info("Telegram Bot stopped");
  }

  /**
   * 长轮询入口。
   */
  private async pollUpdates(): Promise<void> {
    if (!this.isRunning) return;
    if (this.pollInFlight) return;
    if (Date.now() < this.nextPollAllowedAt) return;
    this.pollInFlight = true;

    try {
      const updates = await this.api.requestJson<TelegramUpdate[]>("getUpdates", {
        offset: this.lastUpdateId + 1,
        limit: 10,
        timeout: 30,
      });

      if (this.consecutivePollErrors > 0) {
        this.logger.info(
          `Telegram polling recovered after ${this.consecutivePollErrors} failed attempt(s)`,
        );
      }
      this.consecutivePollErrors = 0;
      this.nextPollAllowedAt = 0;

      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
      }
      await this.stateStore.saveLastUpdateId(this.lastUpdateId);

      for (const update of updates) {
        try {
          if (update.message) {
            await this.onMessage(update.message);
          } else if (update.callback_query) {
            await this.onCallbackQuery(update.callback_query);
          }
        } catch (error) {
          this.logger.error(
            `Failed to process message (update_id: ${update.update_id})`,
            { error: String(error) },
          );
        }
      }
    } catch (error) {
      const msg = (error as Error)?.message || String(error);
      if (!this.isPollingTimeoutError(msg)) {
        const looksLikeWebhookConflict =
          /webhook/i.test(msg) || /Conflict/i.test(msg) || /getUpdates/i.test(msg);
        if (!this.clearedWebhookOnce && looksLikeWebhookConflict) {
          try {
            await this.api.requestJson<boolean>("deleteWebhook", {
              drop_pending_updates: false,
            });
            this.clearedWebhookOnce = true;
            this.logger.warn(
              "Telegram polling conflict detected; cleared webhook and will retry",
              { error: msg },
            );
            await this.onWebhookConflictResolved?.();
            this.consecutivePollErrors = 0;
            this.nextPollAllowedAt = 0;
            return;
          } catch (clearError) {
            this.logger.error(
              "Telegram polling conflict detected; failed to clear webhook",
              { error: msg, clearError: String(clearError) },
            );
          }
        }

        this.consecutivePollErrors += 1;
        const backoffMs = this.computePollBackoffMs(this.consecutivePollErrors);
        this.nextPollAllowedAt = Date.now() + backoffMs;
        const retryInSeconds = Math.ceil(backoffMs / 1000);

        if (this.isLikelyNetworkError(msg)) {
          this.logger.warn(
            `Telegram polling network error, retrying in ${retryInSeconds}s: ${msg}`,
          );
        } else {
          this.logger.error(
            `Telegram polling error, retrying in ${retryInSeconds}s: ${msg}`,
          );
        }
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  /**
   * 是否属于 polling timeout。
   */
  private isPollingTimeoutError(message: string): boolean {
    return /timeout/i.test(String(message || ""));
  }

  /**
   * 是否更像网络抖动类错误。
   */
  private isLikelyNetworkError(message: string): boolean {
    return /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|TLS/i.test(
      String(message || ""),
    );
  }

  /**
   * 计算 polling 失败退避时间。
   */
  private computePollBackoffMs(failureCount: number): number {
    const safeFailureCount = Number.isFinite(failureCount) ? failureCount : 1;
    const exponent = Math.max(0, safeFailureCount - 1);
    return Math.min(30_000, 1_000 * Math.pow(2, exponent));
  }
}

/**
 * 创建 Telegram 平台 client。
 */
export function createTelegramPlatformClient(
  config: TelegramConfig,
  options: Omit<TelegramPlatformClientOptions, "botToken">,
): TelegramPlatformClient | null {
  if (!config.enabled || !config.botToken || config.botToken === "${}") {
    return null;
  }
  return new TelegramPlatformClient({
    ...options,
    botToken: config.botToken,
  });
}
