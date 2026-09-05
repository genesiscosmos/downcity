/**
 * City RPC 宿主运行时能力类型。
 *
 * 所有回调都显式接收 Agent ID，使 transport 不依赖任何持久化层，也不会把
 * 多 Agent 的运行时配置复制成第二份事实源。
 */

import type { AgentSessionModelResolver } from "@/city/transport/types/AgentSessionModelResolver.js";
import type { Agent } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";

/** City RPC transport 所需的宿主能力。 */
export interface CityRpcRuntimeOptions {
  /** 处理宿主关闭请求；调用方负责安排实际进程退出。 */
  shutdown?: () => void | Promise<void>;

  /** 为指定 Agent 创建远程 Session 所需的模型解析器。 */
  resolve_session_model?: (input: {
    /** 当前请求已经解析出的 Agent 实例。 */
    readonly agent: Agent;
    /** 当前请求已经进入的 Workspace 实例。 */
    readonly workspace: WorkspaceRuntime;
    /** 远程 Session 请求指定的模型标识。 */
    readonly model_id: string;
  }) => ReturnType<AgentSessionModelResolver>;

  /** 从事实源重新加载指定 Agent 的 Workspace Env。 */
  reload_workspace_env?: (input: {
    /** 当前请求已经解析出的 Agent 实例。 */
    readonly agent: Agent;
    /** 需要重新加载环境变量的 Workspace 实例。 */
    readonly workspace: WorkspaceRuntime;
  }) => Record<string, string> | Promise<Record<string, string>>;
}
