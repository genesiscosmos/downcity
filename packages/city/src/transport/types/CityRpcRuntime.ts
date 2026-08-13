/**
 * City RPC 宿主运行时能力类型。
 *
 * 所有回调都显式接收 Agent ID，使 transport 不依赖任何持久化层，也不会把
 * 多 Agent 的运行时配置复制成第二份事实源。
 */

import type { AgentSessionModelResolver } from "@/transport/types/AgentSessionModelResolver.js";

/** City RPC transport 所需的宿主能力。 */
export interface CityRpcRuntimeOptions {
  /** 为指定 Agent 创建远程 Session 所需的模型解析器。 */
  resolve_session_model?: (
    agent_id: string,
    model_id: string,
  ) => ReturnType<AgentSessionModelResolver>;

  /** 从事实源重新加载指定 Agent 的 Workspace Env。 */
  reload_workspace_env?: (
    agent_id: string,
  ) => Record<string, string> | Promise<Record<string, string>>;
}
