/**
 * Agent RPC 宿主运行时能力类型。
 *
 * 该类型只投影 internal 管理命令需要的宿主能力，不让 RPC Server 理解 City 的配置文件位置。
 */

import type { AgentSessionModelResolver } from "@/types/AgentSessionModelResolver.js";

/** Agent RPC 宿主运行时能力。 */
export interface AgentRpcRuntimeOptions {
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;

  /**
   * 从宿主事实源重新解析 Workspace Env，并把完整快照提交给 Workspace。
   *
   * 返回值用于 RPC 响应确认，调用方不得把 Env 明文写入日志。
   */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
}
