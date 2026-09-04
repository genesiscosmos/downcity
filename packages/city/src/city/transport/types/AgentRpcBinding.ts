/**
 * AgentRPC 监听绑定类型。
 *
 * 关键点（中文）
 * - 仅描述监听后的可观测信息，不暴露底层 net.Server。
 */

/**
 * AgentRPC 监听绑定信息。
 */
export interface AgentRpcBinding {
  /** 完整 RPC 访问 URL，例如 `rpc://127.0.0.1:15314`。 */
  url: string;
  /** 当前监听主机。 */
  host: string;
  /** 当前监听端口。 */
  port: number;
}

/**
 * AgentRPC 监听参数。
 */
export interface AgentRpcListenOptions {
  /** 监听主机，默认 `127.0.0.1`。 */
  host?: string;
  /** 监听端口，默认 `15314`。 */
  port?: number;
}
