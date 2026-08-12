/**
 * AgentHTTP server 监听绑定类型。
 */

/**
 * AgentHTTP server 监听绑定信息。
 */
export interface AgentHttpBinding {
  /** 完整 HTTP 访问 URL。 */
  url: string;
  /** 当前监听主机。 */
  host: string;
  /** 当前监听端口。 */
  port: number;
}

/**
 * AgentHTTP server 监听参数。
 */
export interface AgentHttpListenOptions {
  /** 监听主机，默认 `127.0.0.1`。 */
  host?: string;
  /** 监听端口（必填）。 */
  port: number;
}
