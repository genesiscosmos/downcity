/**
 * City HTTP 宿主运行时能力类型。
 *
 * City transport 先按 Agent ID 选中 Agent，再把模型解析等宿主能力投影给单
 * Agent HTTP router，避免路由层理解本地 Store 的实现。
 */

import type { AgentSessionModelResolver } from "@/transport/types/AgentSessionModelResolver.js";
import type { Agent } from "@downcity/agent";
import type { AgentWorkspace } from "@downcity/agent/internal";
import type { Hono } from "hono";

/** 宿主为一个 Agent 提供的 HTTP 扩展。 */
export interface CityAgentHttpExtension {
  /** 已组合 SDK Router 的 Agent 子路由。 */
  router: Hono;

  /** CityHTTP 关闭时需要同步释放的宿主资源。 */
  dispose?(): void | Promise<void>;
}

/** City HTTP transport 所需的宿主能力。 */
export interface CityHttpRuntimeOptions {
  /** 为指定 Agent 创建远程 Session 所需的模型解析器。 */
  resolve_session_model?: (
    agent_id: string,
    workspace_id: string,
    model_id: string,
  ) => ReturnType<AgentSessionModelResolver>;

  /** 为一个 Agent 组合 Auth、控制台和应用专属路由。 */
  create_agent_extension?: (input: {
    /** 当前路由对应的本地 Agent。 */
    agent: Agent;
    /** 当前路由对应的 Agent Workspace 执行作用域。 */
    agent_workspace: AgentWorkspace;
    /** City 提供的标准 RemoteAgent SDK Router。 */
    sdk_router: Hono;
  }) => CityAgentHttpExtension;

  /** 挂载到 City HTTP 根路径的宿主扩展 Router。 */
  city_router?: Hono;
}
