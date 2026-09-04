/**
 * QQGatewaySupport：QQ GatewayClient 的纯辅助逻辑。
 *
 * 关键点（中文）
 * - 这里只放不依赖类实例的纯计算与纯解析逻辑。
 * - 让 `QQGatewayClient` 专注于连接编排，而不是状态拼装与 payload 解码细节。
 */

import type { RawData } from "ws";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type { QQGatewayPayload, QqGatewayRuntimeStatus } from "@/chat/channels/qq/types/QqChannel.js";
import type {
  QqGatewayHeartbeatState,
  QqGatewayRuntimeStatusInput,
} from "@/chat/channels/qq/types/QqGatewaySupport.js";

/**
 * WebSocket OPEN 对应的 readyState 数值。
 */
const WS_OPEN_READY_STATE = 1;

/**
 * 解析 QQ API 基础地址。
 */
export function resolveQqGatewayApiBase(useSandbox: boolean): string {
  return useSandbox
    ? "https://sandbox.api.sgroup.qq.com"
    : "https://api.sgroup.qq.com";
}

/**
 * 解析默认 WebSocket Gateway 地址。
 */
export function resolveQqGatewayWsUrl(useSandbox: boolean): string {
  return useSandbox
    ? "wss://sandbox.api.sgroup.qq.com/websocket"
    : "wss://api.sgroup.qq.com/websocket";
}

/**
 * 计算心跳 ACK 超时阈值。
 */
export function getQqHeartbeatAckTimeoutMs(heartbeatIntervalMs: number): number {
  return Math.max(heartbeatIntervalMs * 3, 45000);
}

/**
 * 是否发生心跳 ACK 超时。
 */
export function hasQqHeartbeatTimeout(
  state: QqGatewayHeartbeatState,
  nowMs: number = Date.now(),
): boolean {
  if (!state.pendingHeartbeatSinceMs) return false;
  return nowMs - state.pendingHeartbeatSinceMs >
    getQqHeartbeatAckTimeoutMs(state.heartbeatIntervalMs);
}

/**
 * 心跳是否健康。
 */
export function hasQqHealthyHeartbeat(
  state: QqGatewayHeartbeatState,
  nowMs: number = Date.now(),
): boolean {
  if (!state.wsReadyAtMs) return false;
  if (!state.pendingHeartbeatSinceMs) return true;
  return !hasQqHeartbeatTimeout(state, nowMs);
}

/**
 * 构建 QQ 网关状态快照。
 */
export function buildQqGatewayRuntimeStatus(
  input: QqGatewayRuntimeStatusInput,
): QqGatewayRuntimeStatus {
  const now = Date.now();
  const isOpen = input.wsReadyState === WS_OPEN_READY_STATE;
  const hasContext = Boolean(String(input.wsContextId || "").trim());
  const heartbeatState = {
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    pendingHeartbeatSinceMs: input.pendingHeartbeatSinceMs,
    wsReadyAtMs: input.wsReadyAtMs,
  };
  const heartbeatHealthy = hasQqHealthyHeartbeat(heartbeatState, now);
  const heartbeatTimedOut = hasQqHeartbeatTimeout(heartbeatState, now);
  const linkState =
    !input.isRunning
      ? "disconnected"
      : isOpen && hasContext && heartbeatHealthy
        ? "connected"
        : "unknown";

  const statusText = !input.isRunning
    ? "stopped"
    : !isOpen
      ? "connecting"
      : !hasContext
        ? "ws_open_wait_ready"
        : heartbeatTimedOut
          ? "heartbeat_timeout"
          : heartbeatHealthy
            ? "ws_online"
            : "ws_open_wait_heartbeat";

  return {
    running: input.isRunning,
    linkState,
    statusText,
    detail: {
      appId: input.appId || null,
      wsReadyState: input.wsReadyState,
      wsContextId: input.wsContextId || null,
      wsReadyAtMs: input.wsReadyAtMs || null,
      heartbeatHealthy,
      heartbeatIntervalMs: input.heartbeatIntervalMs,
      heartbeatAckTimeoutMs: getQqHeartbeatAckTimeoutMs(
        input.heartbeatIntervalMs,
      ),
      lastHeartbeatSentAtMs: input.lastHeartbeatSentAtMs || null,
      lastHeartbeatAckAtMs: input.lastHeartbeatAckAtMs || null,
      pendingHeartbeatSinceMs: input.pendingHeartbeatSinceMs || null,
      reconnectAttempts: input.reconnectAttempts,
      maxReconnectAttempts: input.maxReconnectAttempts,
      reconnectScheduled: input.reconnectScheduled,
      sandbox: input.useSandbox,
    },
  };
}

/**
 * 解析原始 Gateway 载荷。
 */
export function parseQqGatewayPayload(rawData: RawData): QQGatewayPayload | null {
  try {
    const text = Buffer.isBuffer(rawData)
      ? rawData.toString("utf-8")
      : Array.isArray(rawData)
        ? Buffer.concat(rawData).toString("utf-8")
        : typeof rawData === "string"
          ? rawData
          : Buffer.from(rawData).toString("utf-8");
    const parsed = JSON.parse(text) as PluginJsonValue;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as PluginJsonObject;
    const op = typeof obj.op === "number" ? obj.op : Number(obj.op);
    if (!Number.isFinite(op)) return null;
    return {
      op,
      ...(obj.d && typeof obj.d === "object" && !Array.isArray(obj.d)
        ? { d: obj.d as PluginJsonObject }
        : {}),
      ...(typeof obj.s === "number" ? { s: obj.s } : {}),
      ...(typeof obj.t === "string" ? { t: obj.t } : {}),
    };
  } catch {
    return null;
  }
}
