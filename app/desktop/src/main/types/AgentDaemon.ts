/**
 * Desktop 连接本机 Agent daemon 所需的运行时类型。
 *
 * 这些类型只描述 daemon 元数据与身份校验边界，不进入 Renderer IPC。
 */

/** 定位一个已注册 Agent 的运行中 daemon。 */
export interface ResolveAgentDaemonInput {
  /** 需要连接的 Agent 全局稳定标识。 */
  agent_id: string;
  /** Registry 中该 Agent 当前使用的 Workspace 绝对路径。 */
  workspace_path: string;
}

/** `daemon.json` 中供 Desktop 验证连接目标的最小字段。 */
export interface AgentDaemonMeta {
  /** daemon 子进程的操作系统进程 ID。 */
  pid: number;
  /** 每次 daemon 启动生成的唯一实例标识。 */
  instance_id: string;
  /** daemon 当前运行的 Agent 标识。 */
  agent_id: string;
  /** daemon 当前执行所使用的 Workspace 绝对路径。 */
  workspace_path: string;
  /** daemon 子进程的完整启动参数。 */
  args: string[];
}

/** daemon 通过 `internal.status.get` 返回的运行身份。 */
export interface AgentDaemonIdentity {
  /** RPC 服务所在进程的操作系统进程 ID。 */
  pid: number;
  /** RPC 服务当前运行的 Agent 标识。 */
  agent_id: string;
  /** RPC 服务当前执行所使用的 Workspace 绝对路径。 */
  workspace_path: string;
  /** RPC 服务所属 daemon 的唯一实例标识。 */
  instance_id: string;
}
