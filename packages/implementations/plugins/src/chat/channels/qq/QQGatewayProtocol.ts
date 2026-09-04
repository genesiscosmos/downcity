/**
 * QQ Gateway 协议处理。
 *
 * 关键点（中文）
 * - 只负责 Gateway op code 的协议路由与 Identify payload 构造。
 * - 不持有 WebSocket 生命周期状态，所有状态写入通过回调交回 `QQGatewayClient`。
 * - 这样 client 保持单一状态源，协议细节也不会继续挤在连接编排类里。
 */

import type WebSocket from "ws";
import type { PluginLogger } from "@downcity/city/plugin";
import type {
  QQGatewayPayload,
  QqDispatchHandler,
} from "@/chat/channels/qq/types/QqChannel.js";
import { EventType, OpCode } from "@/chat/channels/qq/types/QqChannel.js";

/**
 * Gateway payload 处理参数。
 */
export interface HandleQqGatewayPayloadParams {
  /**
   * 日志器。
   */
  logger: PluginLogger;
  /**
   * 当前 payload。
   */
  payload: QQGatewayPayload;
  /**
   * 记录服务端序列号。
   */
  setLastSeq(seq: number): void;
  /**
   * 启动心跳。
   */
  startHeartbeat(intervalMs: number): void;
  /**
   * 发送 Identify。
   */
  sendIdentify(): Promise<void>;
  /**
   * 标记 READY。
   */
  markReady(contextId: string): void;
  /**
   * 标记 RESUMED。
   */
  markResumed(): void;
  /**
   * 标记心跳 ACK。
   */
  markHeartbeatAck(): void;
  /**
   * 清理 access token 缓存。
   */
  clearAccessTokenCache(): void;
  /**
   * 触发 socket 自愈关闭。
   */
  closeSocketForRecovery(reason: string): void;
  /**
   * Dispatch 事件回调。
   */
  onDispatch(params: QqDispatchHandler): Promise<void>;
}

/**
 * Identify 发送参数。
 */
export interface SendQqGatewayIdentifyParams {
  /**
   * 当前 socket。
   */
  socket: WebSocket | null;
  /**
   * 日志器。
   */
  logger: PluginLogger;
  /**
   * 获取鉴权 token。
   */
  getAuthToken(): Promise<string>;
}

/**
 * 处理 QQ Gateway payload。
 */
export async function handleQqGatewayPayload(
  params: HandleQqGatewayPayloadParams,
): Promise<void> {
  const { op, d, s, t } = params.payload;
  if (s) {
    params.setLastSeq(s);
  }

  switch (op) {
    case OpCode.Hello: {
      const heartbeatIntervalMs =
        typeof d?.heartbeat_interval === "number" ? d.heartbeat_interval : 30000;
      params.startHeartbeat(heartbeatIntervalMs);
      await params.sendIdentify();
      break;
    }
    case OpCode.Dispatch: {
      const eventType = String(t || "");
      if (eventType === EventType.READY) {
        params.markReady(typeof d?.context_id === "string" ? d.context_id : "");
      } else if (eventType === EventType.RESUMED) {
        params.markResumed();
      }
      await params.onDispatch({
        eventType,
        data: d || {},
      });
      break;
    }
    case OpCode.HeartbeatAck:
      params.markHeartbeatAck();
      params.logger.debug("收到心跳响应");
      break;
    case OpCode.Reconnect:
      params.logger.warn("服务端要求重连");
      params.closeSocketForRecovery("server_reconnect_opcode");
      break;
    case OpCode.InvalidContext:
      params.logger.error("无效的 Context，需要重新鉴权");
      params.clearAccessTokenCache();
      setTimeout(async () => {
        try {
          await params.sendIdentify();
        } catch (error) {
          params.logger.error("重新鉴权失败", { error: String(error) });
        }
      }, 2000);
      break;
  }
}

/**
 * 发送 QQ Gateway Identify。
 */
export async function sendQqGatewayIdentify(
  params: SendQqGatewayIdentifyParams,
): Promise<void> {
  const authToken = await params.getAuthToken();
  const intents = getQqGatewayIntents();
  params.logger.info(`发送鉴权请求 (Identify)，intents: ${intents}`);

  const identifyPayload = {
    op: OpCode.Identify,
    d: {
      token: authToken,
      intents,
      shard: [0, 1],
      properties: {
        $os: "linux",
        $browser: "downcity",
        $device: "downcity",
      },
    },
  };

  params.logger.debug(`Identify payload: ${JSON.stringify(identifyPayload)}`);
  params.socket?.send(JSON.stringify(identifyPayload));
  params.logger.info("已发送鉴权请求");
}

/**
 * 获取订阅事件位掩码。
 */
function getQqGatewayIntents(): number {
  const GROUP_AND_C2C_EVENT = 1 << 25;
  const AUDIO_ACTION = 1 << 29;
  return GROUP_AND_C2C_EVENT | AUDIO_ACTION;
}
