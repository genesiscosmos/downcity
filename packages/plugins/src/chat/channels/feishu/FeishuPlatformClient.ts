/**
 * FeishuPlatformClient：飞书平台连接与消息能力封装。
 *
 * 关键点（中文）
 * - 负责 SDK client / WS client、token 缓存、启动停止与 runtime 状态。
 * - 查询类能力与发送类能力已经拆到旁路模块，当前文件只保留平台宿主职责。
 * - `FeishuBot` 只调用这里暴露的平台能力，不再直接持有底层 Feishu 连接细节。
 */

import type { PluginContext } from "@downcity/agent";
import type {
  FeishuConfig,
  FeishuDownloadedAttachment,
  FeishuMessageEvent,
  FeishuMessagePayloadType,
} from "@/chat/channels/feishu/types/FeishuChannel.js";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import type { ParsedFeishuAttachmentCommand } from "@/chat/types/FeishuAttachment.js";
import type { FeishuIncomingAttachmentDescriptor } from "@/chat/types/FeishuInboundAttachment.js";
import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";
import {
  downloadFeishuIncomingAttachments,
  resolveFeishuChatTitle,
  resolveFeishuReplyContext,
  resolveFeishuSenderName,
} from "./FeishuPlatformLookup.js";
import {
  sendFeishuAttachment,
  sendFeishuPlatformMessage,
} from "./FeishuPlatformMessaging.js";
import { loadFeishuSdk } from "./FeishuSdk.js";
import type {
  FeishuSdkClient,
  FeishuSdkWsClient,
} from "./types/FeishuSdk.js";

const FEISHU_INBOUND_ACK_REACTION_TYPE = "OK";

/**
 * Feishu 平台 client 构造参数。
 */
export interface FeishuPlatformClientOptions {
  /**
   * 当前执行上下文。
   */
  context: PluginContext;
  /**
   * 飞书渠道配置。
   */
  config: Pick<FeishuConfig, "appId" | "appSecret" | "domain">;
  /**
   * 入站消息回调。
   */
  onMessage: (data: FeishuMessageEvent) => Promise<void>;
}

/**
 * 飞书平台 client。
 */
export class FeishuPlatformClient {
  private readonly context: PluginContext;
  private readonly rootPath: string;
  private readonly logger: PluginContext["logger"];
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly domain?: string;
  private readonly onMessage: (data: FeishuMessageEvent) => Promise<void>;

  private client: FeishuSdkClient | null = null;
  private wsClient: FeishuSdkWsClient | null = null;
  private isRunning = false;
  private messageCleanupInterval: NodeJS.Timeout | null = null;
  private appAccessToken = "";
  private appAccessTokenExpiresAtMs = 0;
  private readonly chatTitleByChatId: Map<string, string> = new Map();
  private readonly senderNameBySenderKey: Map<string, string> = new Map();
  private readonly lookupWarnings: Set<string> = new Set();

  constructor(options: FeishuPlatformClientOptions) {
    this.context = options.context;
    this.rootPath = options.context.workspace_path;
    this.logger = options.context.logger;
    this.appId = options.config.appId;
    this.appSecret = options.config.appSecret;
    this.domain = options.config.domain;
    this.onMessage = options.onMessage;
  }

  /**
   * 获取 runtime 快照。
   */
  getExecutorStatus(): {
    running: boolean;
    linkState: "connected" | "disconnected" | "unknown";
    statusText: string;
    detail: Record<string, string | number | boolean | null>;
  } {
    const running = this.isRunning;
    const hasClients = Boolean(this.client && this.wsClient);
    const linkState = running && hasClients ? "connected" : running ? "unknown" : "disconnected";
    return {
      running,
      linkState,
      statusText:
        linkState === "connected"
          ? "ws_online"
          : linkState === "unknown"
            ? "starting"
            : "stopped",
      detail: {
        hasClient: Boolean(this.client),
        hasWsClient: Boolean(this.wsClient),
        cachedChatTitleCount: this.chatTitleByChatId.size,
        cachedSenderNameCount: this.senderNameBySenderKey.size,
      },
    };
  }

  /**
   * 连通性测试。
   */
  async testConnection(): Promise<ChatChannelTestResult> {
    const startedAt = Date.now();
    if (!this.appId || !this.appSecret) {
      return {
        channel: "feishu",
        success: false,
        testedAtMs: startedAt,
        message: "App credentials are missing",
      };
    }

    const domain = this.domain || "https://open.feishu.cn";
    const endpoint = `${domain.replace(/\/+$/, "")}/open-apis/auth/v3/app_access_token/internal`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      });
      const raw = await response.text();
      const now = Date.now();
      let code: number | undefined;
      let msg: string | undefined;
      try {
        const parsed = JSON.parse(raw) as { code?: number; msg?: string };
        code = typeof parsed.code === "number" ? parsed.code : undefined;
        msg = typeof parsed.msg === "string" ? parsed.msg : undefined;
      } catch {
        // ignore parse error
      }

      if (response.ok && (code === 0 || code === undefined)) {
        return {
          channel: "feishu",
          success: true,
          testedAtMs: now,
          latencyMs: now - startedAt,
          message: "Connected to Feishu Open API",
          detail: {
            httpStatus: response.status,
            code: code ?? null,
          },
        };
      }

      return {
        channel: "feishu",
        success: false,
        testedAtMs: now,
        latencyMs: now - startedAt,
        message: `Feishu API check failed: HTTP ${response.status}${msg ? ` ${msg}` : ""}`,
        detail: {
          httpStatus: response.status,
          code: code ?? null,
        },
      };
    } catch (error) {
      const now = Date.now();
      return {
        channel: "feishu",
        success: false,
        testedAtMs: now,
        latencyMs: now - startedAt,
        message: `Feishu API check failed: ${String(error)}`,
      };
    }
  }

  /**
   * 启动平台连接。
   */
  async start(processedMessages: Set<string>): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Feishu Bot is already running, skipping duplicate startup");
      return;
    }

    this.isRunning = true;
    const baseConfig = {
      appId: this.appId,
      appSecret: this.appSecret,
      domain: this.domain || "https://open.feishu.cn",
    };
    const feishu_sdk = loadFeishuSdk();
    this.client = new feishu_sdk.Client(baseConfig);
    this.wsClient = new feishu_sdk.WSClient(baseConfig);

    const eventDispatcher = new feishu_sdk.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: unknown) => {
        await this.onMessage(data as FeishuMessageEvent);
      },
    });

    this.wsClient.start({ eventDispatcher });
    this.logger.info("Feishu Bot started, using long connection mode");

    this.messageCleanupInterval = setInterval(() => {
      if (processedMessages.size > 1000) {
        processedMessages.clear();
        this.logger.debug("Cleared message deduplication cache");
      }
    }, 5 * 60 * 1000);
  }

  /**
   * 停止平台连接。
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.messageCleanupInterval) {
      clearInterval(this.messageCleanupInterval);
      this.messageCleanupInterval = null;
    }
    if (this.wsClient) {
      this.logger.info("Feishu Bot stopped");
    }
  }

  /**
   * 给入站消息补一个轻量 ack reaction。
   */
  async sendInboundAckReaction(params: { message_id?: string }): Promise<void> {
    const message_id = String(params.message_id || "").trim();
    if (!message_id || !this.client?.im?.v1?.messageReaction?.create) return;
    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: message_id },
        data: {
          reaction_type: {
            emoji_type: FEISHU_INBOUND_ACK_REACTION_TYPE,
          },
        },
      });
    } catch (error) {
      this.logger.warn("飞书入站 ack reaction 失败，继续处理消息", {
        message_id,
        reactionType: FEISHU_INBOUND_ACK_REACTION_TYPE,
        error: String(error),
      });
    }
  }

  /**
   * 解析发送者姓名。
   */
  async resolveSenderName(params: {
    senderId?: string;
    idType?: "open_id" | "user_id" | "union_id";
    chatId?: string;
  }): Promise<string | undefined> {
    return resolveFeishuSenderName(this.getLookupDeps(), params);
  }

  /**
   * 解析群聊/会话标题。
   */
  async resolveChatTitle(chatId: string): Promise<string | undefined> {
    return resolveFeishuChatTitle(this.getLookupDeps(), chatId);
  }

  /**
   * 查询 reply 的父消息上下文。
   */
  async resolveReplyContext(params: {
    parentMessageId?: string;
  }): Promise<InboundReplyContext | undefined> {
    return resolveFeishuReplyContext(this.getLookupDeps(), params);
  }

  /**
   * 下载入站附件。
   */
  async downloadIncomingAttachments(params: {
    message_id: string;
    attachments: FeishuIncomingAttachmentDescriptor[];
  }): Promise<FeishuDownloadedAttachment[]> {
    return downloadFeishuIncomingAttachments(this.getLookupDeps(), params);
  }

  /**
   * 发送附件。
   */
  async sendAttachment(
    chatId: string,
    chatType: string,
    message_id: string | undefined,
    attachment: ParsedFeishuAttachmentCommand,
  ): Promise<void> {
    return sendFeishuAttachment(this.getMessagingDeps(), chatId, chatType, message_id, attachment);
  }

  /**
   * 发送平台消息。
   */
  async sendPlatformMessage(
    chatId: string,
    chatType: string,
    message_id: string | undefined,
    msgType: FeishuMessagePayloadType,
    content: Record<string, unknown> | string,
  ): Promise<void> {
    return sendFeishuPlatformMessage(
      this.getMessagingDeps(),
      chatId,
      chatType,
      message_id,
      msgType,
      content,
    );
  }

  /**
   * 获取 tenant_access_token。
   */
  private async getAppAccessToken(): Promise<string | undefined> {
    const now = Date.now();
    if (this.appAccessToken && this.appAccessTokenExpiresAtMs > now + 10_000) {
      return this.appAccessToken;
    }

    const domain = this.getNormalizedDomain();
    try {
      const response = await fetch(
        `${domain}/open-apis/auth/v3/tenant_access_token/internal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: this.appId,
            app_secret: this.appSecret,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            code?: number;
            tenant_access_token?: string;
            expire?: number;
            msg?: string;
          }
        | null;
      const token =
        typeof payload?.tenant_access_token === "string"
          ? payload.tenant_access_token.trim()
          : "";
      if (!response.ok || payload?.code !== 0 || !token) {
        this.logger.debug("Feishu tenant_access_token 获取失败", {
          httpStatus: response.status,
          code: payload?.code,
          msg: payload?.msg,
        });
        return undefined;
      }

      const expireSeconds =
        typeof payload?.expire === "number" && Number.isFinite(payload.expire)
          ? payload.expire
          : 7200;
      this.appAccessToken = token;
      this.appAccessTokenExpiresAtMs = Date.now() + Math.max(60, expireSeconds) * 1000;
      return token;
    } catch {
      return undefined;
    }
  }

  /**
   * 为 lookup helper 构造依赖集合。
   */
  private getLookupDeps() {
    return {
      rootPath: this.rootPath,
      logger: this.logger,
      client: this.client,
      getAppAccessToken: () => this.getAppAccessToken(),
      getNormalizedDomain: () => this.getNormalizedDomain(),
      senderNameBySenderKey: this.senderNameBySenderKey,
      chatTitleByChatId: this.chatTitleByChatId,
      lookupWarnings: this.lookupWarnings,
    };
  }

  /**
   * 为 messaging helper 构造依赖集合。
   */
  private getMessagingDeps() {
    return {
      rootPath: this.rootPath,
      logger: this.logger,
      client: this.client,
      getAppAccessToken: () => this.getAppAccessToken(),
      getNormalizedDomain: () => this.getNormalizedDomain(),
    };
  }

  /**
   * 归一化 domain。
   */
  private getNormalizedDomain(): string {
    return (this.domain || "https://open.feishu.cn").replace(/\/+$/, "");
  }
}
