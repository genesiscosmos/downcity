/**
 * `city agent chat` 交互式 TUI 入口。
 *
 * 关键点（中文）
 * - 该模块只做协调器创建与生命周期对接，不再直接持有 UI 状态。
 * - 真实的渲染、输入、布局逻辑在 `tui/AgentChatTuiCoordinator` 中。
 */

import { AgentChatTuiCoordinator } from "@/city/agent/tui/AgentChatTuiCoordinator.js";
import type { AgentChatInteractiveRendererPort } from "@/city/types/AgentChatInteractive.js";
import type { AgentChatSessionSummaryView } from "@/city/agent/AgentChatTypes.js";
import type {
  AgentSessionSecurityStatus,
  AgentSessionStatus,
  SessionApprovalMode,
  SessionMessage,
} from "@downcity/agent";

/**
 * 启动 city agent chat 的交互式 TUI。
 *
 * @param params 启动参数。
 */
export async function run_agent_chat_tui(params: {
  /** 目标 agent id。 */
  agent_id: string;
  /** 初始 session id。 */
  session_id: string;
  /** 列出远程 session。 */
  list_sessions: () => Promise<AgentChatSessionSummaryView[]>;
  /** 创建新 session。 */
  create_session: () => Promise<{ session_id: string }>;
  /** 加载指定 Session 的完整 Chat 上下文。 */
  load_session_context: (session_id: string) => Promise<{
    title: string;
    messages: SessionMessage[];
    security: AgentSessionSecurityStatus;
  }>;
  /** 读取指定 Session 的运行与安全状态。 */
  get_session_status: (
    session_id: string,
  ) => Promise<AgentSessionStatus>;
  /** 更新指定 Session 后续高风险操作使用的审批模式。 */
  set_session_security: (
    session_id: string,
    mode: SessionApprovalMode,
  ) => Promise<void>;
  /** 执行一轮对话。 */
  run_turn: (input: {
    session_id: string;
    message: string;
    interactive_renderer: AgentChatInteractiveRendererPort;
  }) => Promise<{
    success: boolean;
    error?: string;
    emitted_visible_text: boolean;
    text?: string;
  }>;

  /** 处理指定 Session 的 unrestricted sandbox 审批请求。 */
  respond_interaction: (
    session_id: string,
    interaction_id: string,
    decision: "approved" | "denied",
  ) => Promise<{ status: "resolved" | "expired" | "cancelled" }>;

}): Promise<void> {
  const coordinator = new AgentChatTuiCoordinator({
    agent_id: params.agent_id,
    session_id: params.session_id,
    list_sessions: params.list_sessions,
    create_session: params.create_session,
    load_session_context: params.load_session_context,
    get_session_status: params.get_session_status,
    set_session_security: params.set_session_security,
    run_turn: params.run_turn,
    respond_interaction: params.respond_interaction,
  });

  await coordinator.run();
}
