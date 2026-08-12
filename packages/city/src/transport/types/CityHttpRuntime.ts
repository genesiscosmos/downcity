/**
 * City HTTP 宿主运行时能力类型。
 *
 * City transport 先按 Agent ID 选中 Agent，再把模型解析等宿主能力投影给单
 * Agent HTTP router，避免路由层理解本地 Store 的实现。
 */

import type { AgentSessionModelResolver } from "@/transport/types/AgentSessionModelResolver.js";

/** City HTTP transport 所需的宿主能力。 */
export interface CityHttpRuntimeOptions {
  /** 为指定 Agent 创建远程 Session 所需的模型解析器。 */
  resolve_session_model?: (
    agent_id: string,
    model_id: string,
  ) => ReturnType<AgentSessionModelResolver>;
}
