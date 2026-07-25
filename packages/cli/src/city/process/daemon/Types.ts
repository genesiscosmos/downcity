/**
 * City Agent daemon 文件与元数据类型。
 *
 * 关键点（中文）
 * - daemon 是 City 管理 Agent 独立进程的运行时概念。
 * - Agent SDK 不暴露 daemon 进程协议，只保留本地执行与 RPC 能力。
 */

/** daemon pid 文件名。 */
export const DAEMON_PID_FILENAME = "downcity.pid";
/** daemon 日志文件名。 */
export const DAEMON_LOG_FILENAME = "downcity.daemon.log";
/** daemon 元数据文件名。 */
export const DAEMON_META_FILENAME = "downcity.daemon.json";

/**
 * daemon 元数据文件结构。
 */
export interface DaemonMeta {
  /** 当前 daemon 进程的操作系统 pid。 */
  pid: number;
  /** 每次 daemon 启动生成的唯一实例 ID，用于识别 PID 复用。 */
  instance_id: string;
  /** daemon 所属 agent 项目的绝对路径。 */
  project_root: string;
  /** daemon 启动时间（ISO 时间字符串）。 */
  startedAt: string;
  /** 启动 daemon 时使用的命令。 */
  command: string;
  /** 启动 daemon 时使用的参数列表。 */
  args: string[];
  /** 当前 node 可执行文件路径。 */
  node: string;
  /** 当前运行平台。 */
  platform: NodeJS.Platform;
}

/** daemon 通过本机 RPC 返回的运行身份。 */
export interface DaemonRuntimeIdentity {
  /** RPC 服务所属进程的操作系统 pid。 */
  pid: number;
  /** RPC 服务所属 agent 项目的绝对路径。 */
  project_root: string;
  /** 当前 daemon 启动实例的唯一 ID。 */
  instance_id: string;
}

/**
 * daemon 进入 stale 状态的诊断项。
 */
export interface DaemonStaleReason {
  /** 机器可读的原因编码。 */
  code:
    | "process_not_alive"
    | "meta_missing"
    | "meta_invalid"
    | "meta_pid_mismatch"
    | "meta_project_mismatch"
    | "meta_instance_missing";
  /** 面向用户展示的原因说明。 */
  message: string;
}
