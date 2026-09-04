/**
 * QQ Gateway 心跳发送辅助。
 *
 * 关键点（中文）
 * - 只负责心跳 interval 归一化与单次 heartbeat payload 发送。
 * - 心跳状态仍由 `QQGatewayClient` 持有，避免 helper 内部隐藏状态。
 */

import WebSocket from "ws";
import type { PluginLogger } from "@downcity/city/plugin";
import { OpCode } from "@/chat/channels/qq/types/QqChannel.js";
import {
  getQqHeartbeatAckTimeoutMs,
  hasQqHeartbeatTimeout,
} from "./QQGatewaySupport.js";

/**
 * QQ Gateway heartbeat 发送参数。
 */
export interface SendQqGatewayHeartbeatParams {
  /**
   * 当前 socket。
   */
  socket: WebSocket | null;
  /**
   * 日志器。
   */
  logger: PluginLogger;
  /**
   * 最近一次服务端序列号。
   */
  lastSeq: number;
  /**
   * 心跳间隔。
   */
  heartbeatIntervalMs: number;
  /**
   * WebSocket READY 时间。
   */
  wsReadyAtMs: number;
  /**
   * 待 ACK 心跳开始时间。
   */
  pendingHeartbeatSinceMs: number;
  /**
   * 标记心跳发送成功。
   */
  markHeartbeatSent(nowMs: number): void;
  /**
   * 标记待 ACK 心跳开始时间。
   */
  markPendingHeartbeat(nowMs: number): void;
  /**
   * 触发 socket 自愈关闭。
   */
  closeSocketForRecovery(reason: string): void;
}

/**
 * 归一化心跳间隔。
 */
export function normalizeQqHeartbeatIntervalMs(intervalMs: number): number {
  return Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.trunc(intervalMs)
    : 30000;
}

/**
 * 发送单次 QQ Gateway heartbeat。
 */
export function sendQqGatewayHeartbeat(
  params: SendQqGatewayHeartbeatParams,
): void {
  const ws = params.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (
    hasQqHeartbeatTimeout(
      {
        heartbeatIntervalMs: params.heartbeatIntervalMs,
        pendingHeartbeatSinceMs: params.pendingHeartbeatSinceMs,
        wsReadyAtMs: params.wsReadyAtMs,
      },
      now,
    )
  ) {
    params.logger.warn("QQ 心跳 ACK 超时，准备重连", {
      pendingHeartbeatSinceMs: params.pendingHeartbeatSinceMs,
      heartbeatAckTimeoutMs: getQqHeartbeatAckTimeoutMs(
        params.heartbeatIntervalMs,
      ),
    });
    params.closeSocketForRecovery("heartbeat_ack_timeout");
    return;
  }

  const heartbeatPayload = {
    op: OpCode.Heartbeat,
    d: params.lastSeq || null,
  };
  try {
    ws.send(JSON.stringify(heartbeatPayload));
    params.markHeartbeatSent(now);
    if (!params.pendingHeartbeatSinceMs) {
      params.markPendingHeartbeat(now);
    }
    params.logger.debug("发送心跳");
  } catch (error) {
    params.logger.warn("发送 QQ 心跳失败，准备重连", {
      error: String(error),
    });
    params.closeSocketForRecovery("heartbeat_send_failed");
  }
}
