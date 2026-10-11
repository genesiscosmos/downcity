/**
 * CLI City daemon 的运行状态类型。
 *
 * daemon 属于 CLI City 宿主，不属于任何 Agent。所有 Agent 共享同一个进程和
 * City 级 HTTP/RPC 端口，Agent 本身不存在 started/stopped 持久化状态。
 */

/** City daemon pid 文件名。 */
export const DAEMON_PID_FILENAME = "daemon.pid";
/** City daemon 日志文件名。 */
export const DAEMON_LOG_FILENAME = "daemon.log";
/** City daemon 元数据文件名。 */
export const DAEMON_META_FILENAME = "daemon.json";

/** City daemon 启动配置。 */
export interface CityDaemonOptions {
  /** HTTP 监听地址。 */
  host?: string;
  /** City HTTP 端口。 */
  http_port?: number;
  /** City RPC 端口。 */
  rpc_port?: number;
  /** 是否在当前终端前台运行。 */
  foreground?: boolean;
}

/** City daemon 元数据。 */
export interface DaemonMeta {
  /** 操作系统进程 ID。 */
  pid: number;
  /** 每次启动生成的唯一实例 ID，用于识别 PID 复用。 */
  instance_id: string;
  /** 启动时间，使用 ISO 8601。 */
  started_at: string;
  /** HTTP 监听地址。 */
  host: string;
  /** City HTTP 端口。 */
  http_port: number;
  /** RPC 固定监听地址。 */
  rpc_host: string;
  /** City RPC 端口。 */
  rpc_port: number;
  /** 本次启动从本地产品配置装配的 Agent ID 快照。 */
  agent_ids: string[];
  /** daemon 启动命令。 */
  command: string;
  /** daemon 启动参数。 */
  args: string[];
  /** Node.js 版本。 */
  node: string;
  /** 当前平台。 */
  platform: NodeJS.Platform;
}

/** City daemon stale 诊断结果。 */
export interface DaemonStaleReason {
  /** 机器可读原因。 */
  code: "process_not_alive" | "meta_missing" | "meta_invalid" | "meta_pid_mismatch";
  /** 面向用户的说明。 */
  message: string;
}
