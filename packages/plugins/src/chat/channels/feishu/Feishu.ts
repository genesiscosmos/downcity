/**
 * Feishu 渠道门面。
 *
 * 关键点（中文）
 * - `FeishuBot` 只保留入站授权、命令处理、消息入队与回复编排。
 * - Feishu SDK、token、Open API 查询、附件上传下载已经下沉到 `FeishuPlatformClient`。
 * - 纯入站解析逻辑下沉到 `FeishuInbound`，保持渠道门面聚焦主流程。
 */

import fs from "fs-extra";
import path from "path";
import { BaseChatChannel } from "@/chat/channels/BaseChatChannel.js";
import type {
  ChannelChatKeyParams,
  ChannelSendTextParams,
} from "@/chat/channels/BaseChatChannel.js";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import type { ParsedFeishuAttachmentCommand } from "@/chat/types/FeishuAttachment.js";
import type {
  FeishuConfig,
  FeishuMessageEvent,
  FeishuMessagePayloadType,
} from "@/chat/channels/feishu/types/FeishuChannel.js";
import { parseFeishuAttachments } from "./Shared.js";
import { FeishuPlatformClient } from "./FeishuPlatformClient.js";
import { handleFeishuMessage } from "./FeishuMessageHandler.js";
import { isMissingFeishuSdkDependencyError } from "./FeishuSdk.js";
import { get_feishu_dedupe_dir_path } from "@/chat/runtime/ChatStorage.js";

/**
 * 飞书入站确认 reaction 类型。
 *
 * 说明（中文）
 * - 飞书 reaction API 使用 `emoji_type`，不是直接传 Unicode emoji。
 * - 这里选择 `OK` 作为更轻量的“已收到”反馈。
 */
export const FEISHU_INBOUND_ACK_REACTION_TYPE = "OK";

/**
 * 飞书平台适配器。
 */
export class FeishuBot extends BaseChatChannel {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly domain?: string;
  private readonly dedupeDir: string;
  private readonly platform: FeishuPlatformClient;
  private readonly processingMessages: Set<string> = new Set();
  private readonly processedMessages: Set<string> = new Set();
  private readonly knownChats: Map<
    string,
    { chatId: string; chatType: string; chatTitle?: string }
  > = new Map();

  constructor(
    context: PluginContext,
    appId: string,
    appSecret: string,
    domain: string | undefined,
  ) {
    super({ channel: "feishu", context });
    this.appId = appId;
    this.appSecret = appSecret;
    this.domain = domain;
    this.dedupeDir = get_feishu_dedupe_dir_path(context.data_path);
    this.platform = new FeishuPlatformClient({
      context,
      config: {
        appId: this.appId,
        appSecret: this.appSecret,
        domain: this.domain,
      },
      onMessage: async (data) => {
        await this.handleMessage(data);
      },
    });
  }

  protected getChatKey(params: ChannelChatKeyParams): string {
    return this.buildChatKey(params.chatId);
  }

  /** SDK 直连时使用飞书 App ID 作为 issuer。 */
  protected getAccessIssuerFallback(): string {
    return String(this.appId || "").trim();
  }

  protected async sendTextToPlatform(
    params: ChannelSendTextParams,
  ): Promise<void> {
    const chatType = typeof params.chatType === "string" ? params.chatType : "p2p";
    const message_id =
      typeof params.message_id === "string" ? params.message_id : undefined;
    const text = String(params.text ?? "");
    const shouldReplyToMessage = params.reply_to_message === true;

    if (shouldReplyToMessage && message_id && chatType !== "p2p") {
      await this.sendMessage(params.chatId, chatType, message_id, text);
    } else {
      await this.sendChatMessage(params.chatId, chatType, text);
    }
  }

  /**
   * 兼容旧的 per-chat locking 入口。
   */
  private runInChat(_chatKey: string, fn: () => Promise<void>): Promise<void> {
    return fn();
  }

  /**
   * 读取线程级去重集合。
   */
  private async loadDedupeSet(threadId: string): Promise<Set<string>> {
    const file = path.join(this.dedupeDir, `${encodeURIComponent(threadId)}.json`);
    try {
      if (!(await fs.pathExists(file))) return new Set();
      const data = (await fs.readJson(file)) as JsonObject;
      const ids = Array.isArray(data?.ids) ? data.ids : [];
      return new Set(ids.map((value) => String(value)));
    } catch {
      return new Set();
    }
  }

  /**
   * 持久化线程级去重集合。
   */
  private async persistDedupeSet(
    threadId: string,
    set: Set<string>,
  ): Promise<void> {
    const file = path.join(this.dedupeDir, `${encodeURIComponent(threadId)}.json`);
    try {
      await fs.ensureDir(this.dedupeDir);
      const ids = Array.from(set).slice(-800);
      await fs.writeJson(file, { ids }, { spaces: 2 });
    } catch {
      // ignore
    }
  }

  /**
   * 读取 Feishu runtime 快照。
   */
  getExecutorStatus(): {
    running: boolean;
    linkState: "connected" | "disconnected" | "unknown";
    statusText: string;
    detail: Record<string, string | number | boolean | null>;
  } {
    const runtime = this.platform.getExecutorStatus();
    return {
      ...runtime,
      detail: {
        ...runtime.detail,
        knownChatCount: this.knownChats.size,
        dedupeCacheSize: this.processedMessages.size,
      },
    };
  }

  /**
   * 执行 Feishu 连通性测试。
   */
  async testConnection(): Promise<ChatChannelTestResult> {
    return await this.platform.testConnection();
  }

  /**
   * 启动机器人。
   */
  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn("Feishu App ID or App Secret not configured, skipping startup");
      return;
    }

    this.logger.info("🤖 Starting Feishu Bot...");
    try {
      await this.platform.start(this.processedMessages);
    } catch (error) {
      if (isMissingFeishuSdkDependencyError(error)) {
        throw error;
      }
      this.logger.error("Failed to start Feishu Bot", { error: String(error) });
    }
  }

  /**
   * 处理入站消息。
   */
  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    await handleFeishuMessage({
      context: this.context,
      rootPath: this.rootPath,
      logger: this.logger,
      buildChatKey: (chatId) => this.buildChatKey(chatId),
      processedMessages: this.processedMessages,
      processingMessages: this.processingMessages,
      loadDedupeSet: async (threadId) => await this.loadDedupeSet(threadId),
      persistDedupeSet: async (threadId, set) =>
        await this.persistDedupeSet(threadId, set),
      downloadIncomingAttachments: async (params) =>
        await this.platform.downloadIncomingAttachments(params),
      resolveReplyContext: async (params) =>
        await this.platform.resolveReplyContext(params),
      resolveSenderName: async (params) =>
        await this.platform.resolveSenderName(params),
      resolveChatTitle: async (chatId) => await this.platform.resolveChatTitle(chatId),
      sendInboundAckReaction: async (params) =>
        await this.platform.sendInboundAckReaction(params),
      rememberChat: (threadId, value) => {
        this.knownChats.set(threadId, value);
      },
      evaluateIncomingAccess: async (params) =>
        await this.evaluateIncomingAccess(params),
      sendAccessText: async (params) => {
        await this.sendAccessText(params);
      },
      buildAccessBlockedText: (params) =>
        this.buildAccessBlockedText(params),
      runInChat: async (chat_key, fn) => {
        await this.runInChat(chat_key, fn);
      },
      handleCommand: async (params) => {
        await this.handleCommand(
          params.chatId,
          params.chatType,
          params.message_id,
          params.command,
        );
      },
      executeAndReply: async (params) => {
        await this.executeAndReply(
          params.chatId,
          params.chatType,
          params.message_id,
          params.instructions,
          params.actorId,
          params.actorName,
          params.chatTitle,
          params.extra,
        );
      },
      sendErrorMessage: async (params) => {
        await this.sendErrorMessage(
          params.chatId,
          params.chatType,
          params.message_id,
          params.errorText,
        );
      },
    }, data);
  }

  /**
   * 处理命令。
   */
  private async handleCommand(
    chatId: string,
    chatType: string,
    message_id: string,
    command: string,
  ): Promise<void> {
    this.logger.info(`Received Feishu command: ${command}`);

    let responseText = "";
    switch (command.toLowerCase().split(" ")[0]) {
      case "/help":
      case "/帮助":
        responseText = `🤖 Downcity Bot

Available commands:
- /help or /帮助 - View help information
- /status or /状态 - View agent status
- /tasks or /任务 - View task list
- /clear or /清除 - Delete current conversation completely
- <any message> - Execute instruction`;
        break;
      case "/status":
      case "/状态":
        responseText = "📊 Agent status: Running\nTasks: 0\nPending approvals: 0";
        break;
      case "/tasks":
      case "/任务":
        responseText = "📋 Task list\nNo tasks";
        break;
      case "/clear":
      case "/清除":
        await this.clearChatByTarget({
          chatId,
          chatType,
        });
        responseText = "✅ Conversation deleted completely";
        break;
      default:
        responseText = `Unknown command: ${command}\nType /help to view available commands`;
    }

    await this.sendMessage(chatId, chatType, message_id, responseText);
  }

  /**
   * 执行指令并回复。
   */
  private async executeAndReply(
    chatId: string,
    chatType: string,
    message_id: string,
    instructions: string,
    actorId?: string,
    actorName?: string,
    chatTitle?: string,
    extra?: JsonObject,
  ): Promise<void> {
    try {
      const { chat_key } = await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        message_id,
        user_id: actorId,
        username: actorName,
        chatTitle,
        ...(extra ? { extra } : {}),
      });

      this.knownChats.set(chat_key, {
        chatId,
        chatType,
        ...(chatTitle ? { chatTitle } : {}),
      });
    } catch (error) {
      await this.sendErrorMessage(
        chatId,
        chatType,
        message_id,
        `Execution error: ${String(error)}`,
      );
    }
  }

  /**
   * 回复消息。
   */
  async sendMessage(
    chatId: string,
    chatType: string,
    message_id: string,
    text: string,
  ): Promise<void> {
    const parsed = parseFeishuAttachments(text);
    await this.sendParsedMessage(chatId, chatType, message_id, parsed.segments);
  }

  /**
   * 普通发送消息。
   */
  async sendChatMessage(
    chatId: string,
    chatType: string,
    text: string,
  ): Promise<void> {
    const parsed = parseFeishuAttachments(text);
    await this.sendParsedMessage(chatId, chatType, undefined, parsed.segments);
  }

  /**
   * 按正文与附件的真实顺序发送。
   */
  private async sendParsedMessage(
    chatId: string,
    chatType: string,
    message_id: string | undefined,
    segments: Array<
      | {
          kind: "text";
          text: string;
        }
      | {
          kind: "attachment";
          attachment: ParsedFeishuAttachmentCommand;
        }
    >,
  ): Promise<void> {
    for (const segment of segments) {
      if (segment.kind === "text") {
        const normalizedText = String(segment.text || "").trim();
        if (!normalizedText) continue;
        await this.sendPlatformMessage(chatId, chatType, message_id, "text", {
          text: normalizedText,
        });
        continue;
      }

      try {
        await this.sendAttachment(chatId, chatType, message_id, segment.attachment);
      } catch (error) {
        await this.sendPlatformMessage(chatId, chatType, message_id, "text", {
          text: `❌ Failed to send attachment: ${segment.attachment.pathOrUrl}\n${String(error)}`,
        });
      }
    }
  }

  /**
   * 发送单个附件。
   */
  async sendAttachment(
    chatId: string,
    chatType: string,
    message_id: string | undefined,
    attachment: ParsedFeishuAttachmentCommand,
  ): Promise<void> {
    await this.platform.sendAttachment(chatId, chatType, message_id, attachment);
  }

  /**
   * 发送底层平台消息。
   */
  async sendPlatformMessage(
    chatId: string,
    chatType: string,
    message_id: string | undefined,
    msgType: FeishuMessagePayloadType,
    content: Record<string, unknown> | string,
  ): Promise<void> {
    await this.platform.sendPlatformMessage(chatId, chatType, message_id, msgType, content);
  }

  /**
   * 发送统一错误文本。
   */
  private async sendErrorMessage(
    chatId: string,
    chatType: string,
    message_id: string,
    errorText: string,
  ): Promise<void> {
    await this.sendMessage(chatId, chatType, message_id, `❌ ${errorText}`);
  }

  /**
   * 停止机器人。
   */
  async stop(): Promise<void> {
    await this.platform.stop();
    this.processedMessages.clear();
  }

  /**
   * 生成 chat_key。
   */
  private buildChatKey(chatId: string): string {
    return `feishu-chat-${chatId}`;
  }
}

/**
 * 创建飞书机器人实例。
 */
export async function createFeishuBot(
  config: FeishuConfig,
  context: PluginContext,
): Promise<FeishuBot | null> {
  if (!config.enabled || !config.appId || !config.appSecret) {
    return null;
  }

  return new FeishuBot(context, config.appId, config.appSecret, config.domain);
}
