/**
 * Daemon API 协议类型模块。
 *
 * 关键点（中文）
 * - 这里描述的是 CLI 与 agent daemon 之间的远程访问契约，不包含具体 HTTP 实现。
 * - plugin runtime 等上层模块只依赖这些协议类型，不需要感知 City/daemon 的内部实现细节。
 * - 该文件属于 `main/city/daemon/*` 的协议边界，而不是通用 HTTP 类型目录。
 */

import type { JsonValue } from "@downcity/agent";

/**
 * Daemon 服务端点。
 */
export type DaemonEndpoint = {
  host: string;
  port: number;
  baseUrl: string;
};

/**
 * Daemon HTTP 方法白名单。
 */
export type DaemonHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * JSON API 调用参数。
 *
 * 关键点（中文）
 * - `agent_id` 用于读取该 Agent 的全局 daemon runtime 元数据。
 * - `host/port` 可显式覆盖自动解析结果。
 */
export type DaemonJsonApiCallParams = {
  /** 目标受管 Agent 的稳定全局 ID。 */
  agent_id: string;
  path: string;
  method?: DaemonHttpMethod;
  body?: JsonValue;
  /**
   * 单次调用超时（毫秒）。
   *
   * 说明（中文）
   * - 当前 City Agent HTTP gateway client 会消费该参数。
   * - 用于 `session execute`、`plugin action` 这类可能持续几十秒的请求，
   *   避免被默认短超时误判成“Agent runtime 未启动”。
   */
  timeoutMs?: number;
  host?: string;
  port?: number;
  authToken?: string;
};

/**
 * JSON API 通用返回结构。
 *
 * 语义（中文）
 * - `success=true` 时读取 `data`。
 * - `success=false` 时读取 `error`（可选 `status`）。
 */
export type DaemonJsonApiCallResult<T> = {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
};
