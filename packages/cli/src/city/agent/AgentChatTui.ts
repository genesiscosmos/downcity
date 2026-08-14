/**
 * `city agent chat` 交互式 TUI 入口。
 *
 * 关键点（中文）
 * - 该模块只做协调器创建与生命周期对接，不再直接持有 UI 状态。
 * - 真实的渲染、输入、布局逻辑在 `tui/AgentChatTuiCoordinator` 中。
 */

import { AgentChatTuiCoordinator } from "@/city/agent/tui/AgentChatTuiCoordinator.js";
import type {
  AgentChatTuiCoordinatorOptions,
  AgentChatTuiResult,
} from "@/city/types/AgentChatTui.js";

/**
 * 启动 city agent chat 的交互式 TUI。
 *
 * @param params 启动参数。
 * @returns 用户退出 Chat 时的导航动作与当前 Session。
 */
export async function run_agent_chat_tui(
  params: AgentChatTuiCoordinatorOptions,
): Promise<AgentChatTuiResult> {
  const coordinator = new AgentChatTuiCoordinator({
    agent_id: params.agent_id,
    session_id: params.session_id,
    remote_agent: params.remote_agent,
  });

  return await coordinator.run();
}
