/**
 * QQ Gateway 支撑模块共享类型。
 *
 * 关键点（中文）
 * - 承载 `QQGatewaySupport` 这类纯辅助模块的输入契约。
 * - 保持与 `QQGatewayClient` 的运行态字段一一对应，避免 support 层直接依赖类实例。
 */

/**
 * 构建 QQ 网关状态快照所需的输入。
 */
export interface QqGatewayRuntimeStatusInput {
  /**
   * 当前网关流程是否已进入运行态。
   */
  isRunning: boolean;

  /**
   * 当前 WebSocket readyState。
   */
  wsReadyState: number | null;

  /**
   * 当前 WebSocket Context ID。
   */
  wsContextId: string;

  /**
   * 最近一次 READY/RESUMED 生效时间。
   */
  wsReadyAtMs: number;

  /**
   * 心跳间隔。
   */
  heartbeatIntervalMs: number;

  /**
   * 最近一次发送心跳的时间。
   */
  lastHeartbeatSentAtMs: number;

  /**
   * 最近一次收到心跳 ACK 的时间。
   */
  lastHeartbeatAckAtMs: number;

  /**
   * 当前尚未确认的心跳起始时间。
   */
  pendingHeartbeatSinceMs: number;

  /**
   * 当前已发生的重连次数。
   */
  reconnectAttempts: number;

  /**
   * 允许的最大重连次数。
   */
  maxReconnectAttempts: number;

  /**
   * 当前是否已经安排了重连定时器。
   */
  reconnectScheduled: boolean;

  /**
   * 是否处于 QQ 沙箱环境。
   */
  useSandbox: boolean;

  /**
   * QQ AppId。
   */
  appId: string;
}

/**
 * QQ 心跳状态计算输入。
 */
export interface QqGatewayHeartbeatState {
  /**
   * 心跳间隔。
   */
  heartbeatIntervalMs: number;

  /**
   * 当前待确认心跳的起始时间。
   */
  pendingHeartbeatSinceMs: number;

  /**
   * 最近一次 READY/RESUMED 生效时间。
   */
  wsReadyAtMs: number;
}
