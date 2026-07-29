/**
 * Agent RPC 宿主运行时能力类型。
 *
 * 该类型只投影 internal 管理命令需要的宿主能力，不让 RPC Server 理解 City 的配置文件位置。
 */

/** Agent RPC 宿主运行时能力。 */
export interface AgentRpcRuntimeOptions {
  /**
   * 从宿主事实源重新解析 Workspace Env，并把完整快照提交给 Workspace。
   *
   * 返回值用于 RPC 响应确认，调用方不得把 Env 明文写入日志。
   */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
}
