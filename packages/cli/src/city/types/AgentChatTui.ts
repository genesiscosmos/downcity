/**
 * Agent Chat TUI 组合入口类型。
 *
 * TUI 直接复用调用方持有的 RemoteAgent，Session 订阅生命周期由 Coordinator 管理。
 */

import type { AgentChatClient } from "@/city/agent/AgentChatRemote.js";

/** AgentChatTuiCoordinator 的构造依赖。 */
export interface AgentChatTuiCoordinatorOptions {
  /** 目标 Agent 的稳定标识。 */
  agent_id: string;
  /** 首次进入 TUI 时激活的 Session 标识。 */
  session_id: string;
  /** Chat TUI 生命周期内唯一的远程 Agent 客户端。 */
  remote_agent: AgentChatClient;
}
