/**
 * Agent Chat TUI 组合入口类型。
 *
 * TUI 直接复用调用方持有的 RemoteAgent，Session 订阅生命周期由 Coordinator 管理。
 */

import type { AgentChatClient } from "@/city/agent/AgentChatRemote.js";

/** Chat TUI 退出后交给外层页面处理的导航动作。 */
export type AgentChatTuiAction = "exit" | "configure";

/** Chat TUI 的导航结果。 */
export interface AgentChatTuiResult {
  /** 用户离开 Chat 的方式；configure 表示应打开当前 Agent 的配置页。 */
  action: AgentChatTuiAction;
  /** TUI 退出时实际激活的 Session，用于配置完成后准确恢复原对话。 */
  session_id: string;
}

/** AgentChatTuiCoordinator 的构造依赖。 */
export interface AgentChatTuiCoordinatorOptions {
  /** 目标 Agent 的稳定标识。 */
  agent_id: string;
  /** 首次进入 TUI 时激活的 Session 标识。 */
  session_id: string;
  /** Chat TUI 生命周期内唯一的远程 Agent 客户端。 */
  remote_agent: AgentChatClient;
}

/** Agent Chat 完整导航流程的启动参数。 */
export interface AgentChatNavigationOptions extends AgentChatTuiCoordinatorOptions {
  /** 打开当前 Agent 配置页；该回调只会在 Chat TUI 完全关闭后执行。 */
  configure_agent: (agent_id: string) => Promise<void>;
}
