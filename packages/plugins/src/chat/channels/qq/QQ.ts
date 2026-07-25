/**
 * QQ 渠道门面。
 *
 * 关键点（中文）
 * - `QQBot` 只保留渠道层编排职责：入站授权、命令处理、消息入队、回复调度。
 * - Gateway 连接、自愈重连、消息回发已经下沉到 `QQGatewayClient`。
 * - 文本清洗、作者识别、标题解析、附件宽松提取已经下沉到 `QQInbound`。
 * - READY 身份解析、命令映射、入站增强组装已经下沉到 `QQSupport`。
 */

import { BaseChatChannel } from "@/chat/channels/BaseChatChannel.js";
import { parse_chat_message_markup } from "@downcity/agent";
import { QqInboundDedupeStore } from "./QQInboundDedupe.js";
import { getQqEventCaptureConfig } from "./QQEventCapture.js";
import { QQGatewayClient } from "./QQGatewayClient.js";
import {
  extractQqReadyIdentity,
  resolveQqCommandAction,
} from "./QQSupport.js";
import {
  handleQqC2CMessage,
  handleQqChannelMessage,
  handleQqGroupMessage,
  type QQMessageHandlerOptions,
  type QqMessageActor,
} from "./QQMessageHandler.js";
import type {
  ChannelChatKeyParams,
  ChannelSendTextParams,
} from "@/chat/channels/BaseChatChannel.js";
import type { PluginContext } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import type { QQConfig, QQMessageData } from "@/chat/channels/qq/types/QqChannel.js";
import { EventType } from "@/chat/channels/qq/types/QqChannel.js";

/**
 * QQ 平台适配器。
 */
export class QQBot extends BaseChatChannel {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly useSandbox: boolean;
  private readonly gateway: QQGatewayClient;
  private readonly inboundDedupeStore: QqInboundDedupeStore;
  private readonly msgSeqByMessageKey: Map<string, number> = new Map();
  private botUserId = "";
  private botDisplayName = "";

  constructor(
    context: PluginContext,
    appId: string,
    appSecret: string,
    useSandbox: boolean = false,
  ) {
    super({ channel: "qq", context });
    this.appId = appId;
    this.appSecret = appSecret;
    this.useSandbox = useSandbox;
    this.inboundDedupeStore = new QqInboundDedupeStore({
      rootPath: this.rootPath,
      logger: this.logger,
    });
    this.gateway = new QQGatewayClient({
      rootPath: this.rootPath,
      logger: this.logger,
      appId: this.appId,
      appSecret: this.appSecret,
      useSandbox: this.useSandbox,
      captureConfig: getQqEventCaptureConfig(this.rootPath),
      onDispatch: async (params) => {
        await this.handleDispatch(params.eventType, params.data);
      },
    });
  }

  protected getChatKey(params: ChannelChatKeyParams): string {
    const chatType =
      typeof params.chatType === "string" && params.chatType
        ? params.chatType
        : "unknown";
    return `qq-${chatType}-${params.chatId}`;
  }

  /** SDK 直连时使用 QQ App ID 作为 issuer。 */
  protected getAccessIssuerFallback(): string {
    return String(this.appId || "").trim();
  }

  protected async sendTextToPlatform(
    params: ChannelSendTextParams,
  ): Promise<void> {
    const parsedMessage = parse_chat_message_markup(String(params.text ?? ""));
    if (parsedMessage.files.length > 0) {
      throw new Error("QQ outbound attachment is not supported yet.");
    }

    const chatType = typeof params.chatType === "string" ? params.chatType : "";
    const message_id =
      typeof params.message_id === "string" ? params.message_id : "";
    if (!chatType || !message_id) {
      throw new Error("QQ requires chatType + message_id to send a reply");
    }

    const key = `${chatType}:${params.chatId}:${message_id}`;
    const nextSeq = (this.msgSeqByMessageKey.get(key) ?? 0) + 1;
    this.msgSeqByMessageKey.set(key, nextSeq);
    await this.gateway.sendMessage(
      params.chatId,
      chatType,
      message_id,
      parsedMessage.body_text,
      nextSeq,
    );
  }

  /**
   * 读取 QQ 状态快照。
   */
  getExecutorStatus(): {
    running: boolean;
    linkState: "connected" | "disconnected" | "unknown";
    statusText: string;
    detail: Record<string, string | number | boolean | null>;
  } {
    const runtime = this.gateway.getExecutorStatus();
    return {
      ...runtime,
      detail: {
        ...runtime.detail,
        appId: this.appId || null,
        botName: this.botDisplayName || null,
        botUserId: this.botUserId || null,
        sandbox: this.useSandbox,
      },
    };
  }

  /**
   * 执行 QQ 连通性测试。
   */
  async testConnection(): Promise<ChatChannelTestResult> {
    const result = await this.gateway.testConnection();
    const detail =
      result.detail && typeof result.detail === "object" && !Array.isArray(result.detail)
        ? (result.detail as Record<string, unknown>)
        : {};
    return {
      ...result,
      detail: {
        ...detail,
        botName: this.botDisplayName || null,
        botUserId: this.botUserId || null,
      },
    };
  }

  /**
   * 启动机器人。
   */
  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn(
        "QQ 机器人配置不完整（需要 appId 和 appSecret），跳过启动",
      );
      return;
    }

    this.logger.info("🤖 正在启动 QQ 机器人...");
    this.logger.info(`   AppID: ${this.appId}`);
    this.logger.info(`   沙箱模式: ${this.useSandbox ? "是" : "否"}`);

    try {
      await this.inboundDedupeStore.load();
      await this.gateway.start();
    } catch (error) {
      this.logger.error("启动 QQ Bot 失败", { error: String(error) });
      await this.gateway.stop();
    }
  }

  /**
   * 停止机器人。
   */
  async stop(): Promise<void> {
    await this.gateway.stop();
    this.logger.info("QQ Bot 已停止");
  }

  /**
   * Dispatch 事件总入口。
   */
  private async handleDispatch(
    eventType: string,
    data: JsonObject,
  ): Promise<void> {
    this.logger.info(`收到事件: ${eventType}`);

    switch (eventType) {
      case EventType.READY:
        this.captureReadyIdentity(data);
        break;
      case EventType.RESUMED:
        this.logger.info("连接已恢复");
        break;
      case EventType.GROUP_AT_MESSAGE_CREATE:
        await this.handleGroupMessage({
          eventType: EventType.GROUP_AT_MESSAGE_CREATE,
          data: data as QQMessageData,
        });
        break;
      case EventType.GROUP_MESSAGE_CREATE:
        await this.handleGroupMessage({
          eventType: EventType.GROUP_MESSAGE_CREATE,
          data: data as QQMessageData,
        });
        break;
      case EventType.C2C_MESSAGE_CREATE:
        await this.handleC2CMessage(data as QQMessageData);
        break;
      case EventType.AT_MESSAGE_CREATE:
        await this.handleChannelMessage(data as QQMessageData);
        break;
      default:
        this.logger.debug(`未处理的事件类型: ${eventType}`);
    }
  }

  /**
   * 捕获 READY 事件中的机器人身份信息。
   */
  private captureReadyIdentity(data: JsonObject): void {
    const identity = extractQqReadyIdentity(data);
    this.botDisplayName = identity.botDisplayName;
    this.botUserId = identity.botUserId;
    this.logger.info(`QQ Bot 已就绪，WS Context ID: ${identity.wsContextId}`);
    this.logger.info(`用户: ${this.botDisplayName || "N/A"}`);
  }

  /**
   * 处理群聊消息。
   */
  private async handleGroupMessage(params: {
    eventType: string;
    data: QQMessageData;
  }): Promise<void> {
    await handleQqGroupMessage(this.getMessageHandlerOptions(), params);
  }

  /**
   * 处理 C2C 私聊消息。
   */
  private async handleC2CMessage(data: QQMessageData): Promise<void> {
    await handleQqC2CMessage(this.getMessageHandlerOptions(), data);
  }

  /**
   * 处理频道消息。
   */
  private async handleChannelMessage(data: QQMessageData): Promise<void> {
    await handleQqChannelMessage(this.getMessageHandlerOptions(), data);
  }

  /**
   * 构造 QQ 入站处理依赖。
   */
  private getMessageHandlerOptions(): QQMessageHandlerOptions {
    return {
      context: this.context,
      rootPath: this.rootPath,
      logger: this.logger,
      getBotUserId: () => this.botUserId,
      getChatKey: (params) => this.getChatKey(params),
      evaluateIncomingAccess: async (params) =>
        await this.evaluateIncomingAccess(params),
      sendAccessText: async (params) => {
        await this.sendAccessText(params);
      },
      buildAccessBlockedText: (params) =>
        this.buildAccessBlockedText(params),
      shouldSkipDuplicatedInboundMessage: async (eventType, message_id) =>
        await this.shouldSkipDuplicatedInboundMessage(eventType, message_id),
      enqueueAuditMessage: async (params) => {
        await this.enqueueAuditMessage(params);
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
          params.actor,
          params.chatTitle,
        );
      },
      getAuthToken: async () => await this.gateway.getAuthToken(),
    };
  }

  /**
   * 入站去重检查。
   */
  private async shouldSkipDuplicatedInboundMessage(
    eventType: string,
    message_id: string | undefined,
  ): Promise<boolean> {
    const id = typeof message_id === "string" ? message_id.trim() : "";
    if (!id) return false;
    const duplicated = await this.inboundDedupeStore.markAndCheckDuplicate({
      eventType,
      message_id: id,
    });
    if (!duplicated) return false;

    this.logger.info("忽略重复入站消息", {
      eventType,
      message_id: id,
    });
    return true;
  }

  /**
   * 处理命令消息。
   */
  private async handleCommand(
    chatId: string,
    chatType: string,
    message_id: string,
    command: string,
  ): Promise<void> {
    this.logger.info(`收到命令: ${command}`);
    const action = resolveQqCommandAction(command);
    if (action.action === "clear_chat") {
      await this.clearChatByTarget({
        chatId,
        chatType,
      });
    }
    await this.gateway.sendMessage(chatId, chatType, message_id, action.responseText);
  }

  /**
   * 执行指令并回复。
   */
  private async executeAndReply(
    chatId: string,
    chatType: string,
    message_id: string,
    instructions: string,
    actor?: QqMessageActor,
    chatTitle?: string,
  ): Promise<void> {
    try {
      await this.enqueueMessage({
        chatId,
        text: instructions,
        chatType,
        message_id,
        ...(actor?.user_id ? { user_id: actor.user_id } : {}),
        ...(actor?.username ? { username: actor.username } : {}),
        ...(chatTitle ? { chatTitle } : {}),
      });
    } catch (error) {
      await this.gateway.sendMessage(
        chatId,
        chatType,
        message_id,
        `❌ 执行错误: ${String(error)}`,
        1,
      );
    }
  }
}

/**
 * 创建 QQ 机器人实例。
 */
export async function createQQBot(
  config: QQConfig,
  context: PluginContext,
): Promise<QQBot | null> {
  if (!config.enabled || !config.appId || !config.appSecret) {
    return null;
  }

  return new QQBot(
    context,
    config.appId,
    config.appSecret,
    config.sandbox || false,
  );
}
