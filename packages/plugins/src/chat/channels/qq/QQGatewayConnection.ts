/**
 * QQ Gateway WebSocket 连接事件绑定。
 *
 * 关键点（中文）
 * - 只负责创建 WebSocket、绑定 open/message/close/error 事件。
 * - runtime 状态仍由 `QQGatewayClient` 持有，避免连接 helper 变成第二个状态源。
 * - message 解析与原始事件捕获在这里完成，业务 payload 交回 client 编排。
 */

import WebSocket, { type RawData } from "ws";
import type { Logger } from "@downcity/agent";
import type {
  QQEventCaptureConfig,
  QQGatewayPayload,
} from "@/chat/channels/qq/types/QqChannel.js";
import { captureQqWsPayload } from "./QQEventCapture.js";
import { parseQqGatewayPayload } from "./QQGatewaySupport.js";

/**
 * QQ Gateway WebSocket 连接参数。
 */
export interface ConnectQqGatewayWebSocketParams {
  /**
   * Gateway WebSocket URL。
   */
  gatewayUrl: string;
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * 原始事件捕获配置。
   */
  captureConfig: QQEventCaptureConfig;
  /**
   * 当前 WebSocket。
   */
  getCurrentSocket(): WebSocket | null;
  /**
   * 更新当前 WebSocket。
   */
  setCurrentSocket(ws: WebSocket | null): void;
  /**
   * 重置连接活性状态。
   */
  resetLivenessState(): void;
  /**
   * 停止心跳。
   */
  stopHeartbeat(): void;
  /**
   * 清理重连 timer。
   */
  clearReconnectTimer(): void;
  /**
   * 重置重连次数。
   */
  resetReconnectAttempts(): void;
  /**
   * 计划重连。
   */
  scheduleReconnect(reason: string, delay_ms?: number): void;
  /**
   * 处理已解析的 Gateway payload。
   */
  handlePayload(payload: QQGatewayPayload): Promise<void>;
}

/**
 * 建立 QQ Gateway WebSocket。
 */
export async function connectQqGatewayWebSocket(
  params: ConnectQqGatewayWebSocketParams,
): Promise<void> {
  params.logger.info(`正在连接 WebSocket: ${params.gatewayUrl}`);
  closePreviousSocket(params.getCurrentSocket());
  params.stopHeartbeat();
  params.resetLivenessState();

  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const ws = new WebSocket(params.gatewayUrl);
    params.setCurrentSocket(ws);

    ws.on("open", () => {
      if (params.getCurrentSocket() !== ws) return;
      params.logger.info("WebSocket 连接已建立");
      params.resetReconnectAttempts();
      params.clearReconnectTimer();
      params.resetLivenessState();
      resolveOnce();
    });

    ws.on("message", async (data: RawData) => {
      if (params.getCurrentSocket() !== ws) return;
      await handleSocketMessage(params, data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (params.getCurrentSocket() !== ws) return;
      const reasonText = Buffer.isBuffer(reason)
        ? reason.toString("utf-8")
        : String(reason || "");
      params.logger.warn(`WebSocket 连接关闭: ${code} - ${reasonText}`);
      params.setCurrentSocket(null);
      params.stopHeartbeat();
      params.resetLivenessState();
      params.scheduleReconnect(`ws_closed:${code}`);
      rejectOnce(new Error(`QQ websocket closed before ready: ${code} ${reasonText}`));
    });

    ws.on("error", (error: Error) => {
      if (params.getCurrentSocket() !== ws) return;
      params.logger.error("WebSocket 错误", { error: String(error) });
      rejectOnce(error);
    });
  });
}

/**
 * 关闭旧 socket。
 */
function closePreviousSocket(previousWs: WebSocket | null): void {
  if (
    previousWs &&
    (previousWs.readyState === WebSocket.OPEN ||
      previousWs.readyState === WebSocket.CONNECTING)
  ) {
    try {
      previousWs.close();
    } catch {
      // 关键点（中文）：旧连接关闭失败不影响新连接建立。
    }
  }
}

/**
 * 解析、捕获并分发一条 socket message。
 */
async function handleSocketMessage(
  params: ConnectQqGatewayWebSocketParams,
  data: RawData,
): Promise<void> {
  try {
    const payload = parseQqGatewayPayload(data);
    if (!payload) {
      params.logger.warn("收到无法解析的 QQ WebSocket 消息，已忽略");
      return;
    }
    params.logger.debug(
      `收到 WebSocket 消息: op=${payload.op}, t=${payload.t || "N/A"}`,
    );
    await captureQqWsPayload({
      config: params.captureConfig,
      logger: params.logger,
      payload,
    });
    await params.handlePayload(payload);
  } catch (error) {
    params.logger.error("处理 WebSocket 消息失败", {
      error: String(error),
    });
  }
}
