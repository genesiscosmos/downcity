/**
 * QQGatewayClient：QQ 网关连接与发送客户端。
 *
 * 关键点（中文）
 * - 这里专门负责 QQ Gateway WebSocket、心跳、自愈重连与状态持有。
 * - 鉴权 / HTTP 探活 / 发送重试已经拆到旁路模块，当前文件只保留运行时编排。
 * - QQBot 不再直接维护底层 ws / token 细节，只保留渠道编排职责。
 */

import WebSocket from "ws";
import type { Logger } from "@downcity/agent";
import type { JsonObject } from "@downcity/agent";
import type {
  QQEventCaptureConfig,
  QqDispatchHandler,
  QqGatewayRuntimeStatus,
} from "@/chat/channels/qq/types/QqChannel.js";
import {
  fetchQqAccessToken,
  fetchQqGatewayUrl,
  testQqGatewayConnection,
} from "./QQGatewayAuth.js";
import {
  buildQqGatewayRuntimeStatus,
  resolveQqGatewayApiBase,
  resolveQqGatewayWsUrl,
} from "./QQGatewaySupport.js";
import { sendQqMessageWithRetry } from "./QQGatewaySend.js";
import { connectQqGatewayWebSocket } from "./QQGatewayConnection.js";
import {
  handleQqGatewayPayload,
  sendQqGatewayIdentify,
} from "./QQGatewayProtocol.js";
import {
  normalizeQqHeartbeatIntervalMs,
  sendQqGatewayHeartbeat,
} from "./QQGatewayHeartbeat.js";

/**
 * QQGatewayClient 构造参数。
 */
export interface QQGatewayClientOptions {
  /**
   * 项目根目录。
   */
  rootPath: string;
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * QQ AppId。
   */
  appId: string;
  /**
   * QQ AppSecret。
   */
  appSecret: string;
  /**
   * 是否使用沙箱环境。
   */
  useSandbox: boolean;
  /**
   * QQ 原始事件捕获配置。
   */
  captureConfig: QQEventCaptureConfig;
  /**
   * Dispatch 事件回调。
   */
  onDispatch: (params: QqDispatchHandler) => Promise<void>;
}

/**
 * QQ 网关客户端。
 */
export class QQGatewayClient {
  private readonly rootPath: string;
  private readonly logger: Logger;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly useSandbox: boolean;
  private readonly captureConfig: QQEventCaptureConfig;
  private readonly onDispatch: (params: QqDispatchHandler) => Promise<void>;

  private ws: WebSocket | null = null;
  private isRunning = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private wsContextId = "";
  private lastSeq = 0;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private heartbeatIntervalMs = 30000;
  private lastHeartbeatSentAtMs = 0;
  private lastHeartbeatAckAtMs = 0;
  private pendingHeartbeatSinceMs = 0;
  private wsReadyAtMs = 0;
  private readonly sendRequestTimeoutMs = 15000;
  private readonly sendMaxAttempts = 3;
  private accessToken = "";
  private accessTokenExpires = 0;

  private readonly AUTH_API_BASE = "https://bots.qq.com";

  constructor(options: QQGatewayClientOptions) {
    this.rootPath = options.rootPath;
    this.logger = options.logger;
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.useSandbox = options.useSandbox;
    this.captureConfig = options.captureConfig;
    this.onDispatch = options.onDispatch;
  }

  /**
   * 获取当前鉴权字符串。
   */
  async getAuthToken(): Promise<string> {
    const result = await fetchQqAccessToken({
      logger: this.logger,
      authApiBase: this.AUTH_API_BASE,
      appId: this.appId,
      appSecret: this.appSecret,
      cachedAccessToken: this.accessToken,
      cachedAccessTokenExpiresAtMs: this.accessTokenExpires,
    });
    this.accessToken = result.accessToken;
    this.accessTokenExpires = result.accessTokenExpiresAtMs;
    return `QQBot ${result.accessToken}`;
  }

  /**
   * 获取网关状态快照。
   */
  getExecutorStatus(): QqGatewayRuntimeStatus {
    const readyState = typeof this.ws?.readyState === "number" ? this.ws.readyState : null;
    return buildQqGatewayRuntimeStatus({
      isRunning: this.isRunning,
      wsReadyState: readyState,
      wsContextId: this.wsContextId,
      wsReadyAtMs: this.wsReadyAtMs,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      lastHeartbeatSentAtMs: this.lastHeartbeatSentAtMs,
      lastHeartbeatAckAtMs: this.lastHeartbeatAckAtMs,
      pendingHeartbeatSinceMs: this.pendingHeartbeatSinceMs,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      reconnectScheduled: Boolean(this.reconnectTimer),
      useSandbox: this.useSandbox,
      appId: this.appId,
    });
  }

  /**
   * 执行 QQ 连通性测试。
   */
  async testConnection() {
    return testQqGatewayConnection({
      appId: this.appId,
      appSecret: this.appSecret,
      useSandbox: this.useSandbox,
      apiBase: this.getApiBase(),
      getAuthToken: () => this.getAuthToken(),
      getExecutorStatus: () => this.getExecutorStatus(),
      requestReconnect: (reason, delay_ms) => {
        this.requestReconnect(reason, delay_ms);
      },
    });
  }

  /**
   * 启动 QQ 网关。
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("QQ Gateway 已在运行中，跳过重复启动");
      return;
    }

    this.isRunning = true;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.resetWsLivenessState();
    const gatewayUrl = await this.getGatewayUrl();
    await this.connectWebSocket(gatewayUrl);
  }

  /**
   * 停止 QQ 网关。
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.resetWsLivenessState();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 请求一次重连。
   */
  requestReconnect(reason: string, delay_ms?: number): void {
    this.scheduleReconnect(reason, delay_ms);
  }

  /**
   * 发送 QQ 消息。
   */
  async sendMessage(
    chatId: string,
    chatType: string,
    message_id: string,
    text: string,
    msgSeq: number = 1,
  ): Promise<void> {
    try {
      await sendQqMessageWithRetry({
        logger: this.logger,
        apiBase: this.getApiBase(),
        chatId,
        chatType,
        message_id,
        text,
        msgSeq,
        maxAttempts: this.sendMaxAttempts,
        requestTimeoutMs: this.sendRequestTimeoutMs,
        getAuthToken: () => this.getAuthToken(),
        clearAccessTokenCache: () => this.clearAccessTokenCache(),
        closeSocketForRecovery: (reason) => this.closeSocketForRecovery(reason),
        scheduleReconnect: (reason, delay_ms) => this.scheduleReconnect(reason, delay_ms),
      });
    } catch (error) {
      this.logger.error("发送 QQ 消息失败", { error: String(error) });
      throw error;
    }
  }

  /**
   * 获取 API 基础地址。
   */
  private getApiBase(): string {
    return resolveQqGatewayApiBase(this.useSandbox);
  }

  /**
   * 获取默认 WebSocket Gateway。
   */
  private getWsGateway(): string {
    return resolveQqGatewayWsUrl(this.useSandbox);
  }

  /**
   * 获取 Gateway 地址。
   */
  private async getGatewayUrl(): Promise<string> {
    return fetchQqGatewayUrl({
      logger: this.logger,
      apiBase: this.getApiBase(),
      authToken: await this.getAuthToken(),
      fallbackWsGateway: this.getWsGateway(),
    });
  }

  /**
   * 重置网关活性状态。
   */
  private resetWsLivenessState(): void {
    this.wsContextId = "";
    this.lastSeq = 0;
    this.wsReadyAtMs = 0;
    this.lastHeartbeatSentAtMs = 0;
    this.lastHeartbeatAckAtMs = 0;
    this.pendingHeartbeatSinceMs = 0;
  }

  /**
   * 清理 token 缓存。
   */
  private clearAccessTokenCache(): void {
    this.accessToken = "";
    this.accessTokenExpires = 0;
  }

  /**
   * 清理重连定时器。
   */
  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * 计划一次重连。
   */
  private scheduleReconnect(reason: string, delay_ms?: number): void {
    if (!this.isRunning) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("QQ 重连次数已达上限，停止自动重连", {
        reason,
        reconnectAttempts: this.reconnectAttempts,
        maxReconnectAttempts: this.maxReconnectAttempts,
      });
      return;
    }

    const delay =
      typeof delay_ms === "number" && Number.isFinite(delay_ms)
        ? Math.max(0, Math.trunc(delay_ms))
        : 5000 * (this.reconnectAttempts + 1);

    if (this.reconnectTimer) {
      if (delay > 0) return;
      this.clearReconnectTimer();
    }

    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    this.logger.info(
      `QQ 准备重连（原因: ${reason}，第 ${attempt}/${this.maxReconnectAttempts} 次），${delay / 1000} 秒后执行`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isRunning) return;
      try {
        this.clearAccessTokenCache();
        const newGatewayUrl = await this.getGatewayUrl();
        await this.connectWebSocket(newGatewayUrl);
      } catch (error) {
        this.logger.error("QQ 重连失败", { error: String(error), reason });
        this.scheduleReconnect("reconnect_failed");
      }
    }, delay);
  }

  /**
   * 主动关闭当前 socket，交给 close 回调统一进入重连流程。
   */
  private closeSocketForRecovery(reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
      return;
    }
    this.logger.warn(`触发 QQ 链路自愈关闭: ${reason}`);
    try {
      ws.close();
    } catch (error) {
      this.logger.debug("关闭 QQ WebSocket 失败（忽略）", {
        error: String(error),
        reason,
      });
    }
  }

  /**
   * 建立 WebSocket 连接。
   */
  private async connectWebSocket(gatewayUrl: string): Promise<void> {
    await connectQqGatewayWebSocket({
      gatewayUrl,
      logger: this.logger,
      captureConfig: this.captureConfig,
      getCurrentSocket: () => this.ws,
      setCurrentSocket: (ws) => {
        this.ws = ws;
      },
      resetLivenessState: () => this.resetWsLivenessState(),
      stopHeartbeat: () => this.stopHeartbeat(),
      clearReconnectTimer: () => this.clearReconnectTimer(),
      resetReconnectAttempts: () => {
        this.reconnectAttempts = 0;
      },
      scheduleReconnect: (reason, delay_ms) =>
        this.scheduleReconnect(reason, delay_ms),
      handlePayload: async (payload) => {
        await handleQqGatewayPayload({
          logger: this.logger,
          payload,
          setLastSeq: (seq) => {
            this.lastSeq = seq;
          },
          startHeartbeat: (intervalMs) => this.startHeartbeat(intervalMs),
          sendIdentify: async () => {
            await this.sendIdentify();
          },
          markReady: (contextId) => {
            this.wsContextId = contextId;
            this.wsReadyAtMs = Date.now();
          },
          markResumed: () => {
            this.wsReadyAtMs = Date.now();
          },
          markHeartbeatAck: () => {
            this.lastHeartbeatAckAtMs = Date.now();
            this.pendingHeartbeatSinceMs = 0;
          },
          clearAccessTokenCache: () => this.clearAccessTokenCache(),
          closeSocketForRecovery: (reason) => this.closeSocketForRecovery(reason),
          onDispatch: async (dispatch) => {
            await this.onDispatch(dispatch);
          },
        });
      },
    });
  }

  /**
   * 发送鉴权请求。
   */
  private async sendIdentify(): Promise<void> {
    await sendQqGatewayIdentify({
      socket: this.ws,
      logger: this.logger,
      getAuthToken: () => this.getAuthToken(),
    });
  }

  /**
   * 启动心跳。
   */
  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatIntervalMs = normalizeQqHeartbeatIntervalMs(intervalMs);
    this.pendingHeartbeatSinceMs = 0;
    this.lastHeartbeatSentAtMs = 0;
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  /**
   * 发送单次心跳。
   */
  private sendHeartbeat(): void {
    sendQqGatewayHeartbeat({
      socket: this.ws,
      logger: this.logger,
      lastSeq: this.lastSeq,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      wsReadyAtMs: this.wsReadyAtMs,
      pendingHeartbeatSinceMs: this.pendingHeartbeatSinceMs,
      markHeartbeatSent: (nowMs) => {
        this.lastHeartbeatSentAtMs = nowMs;
      },
      markPendingHeartbeat: (nowMs) => {
        this.pendingHeartbeatSinceMs = nowMs;
      },
      closeSocketForRecovery: (reason) => this.closeSocketForRecovery(reason),
    });
  }

  /**
   * 停止心跳。
   */
  private stopHeartbeat(): void {
    if (!this.heartbeatInterval) return;
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }
}
