import type {
  SessionInteractionRequest,
  SessionMutation,
} from "@downcity/agent";

/**
 * `city agent chat` 交互式渲染相关类型。
 *
 * 职责说明（中文）
 * - 统一承接交互式 chat 的终端展示快照与 tool 区块类型。
 * - 保持类型集中在 `types/` 目录，便于后续扩展与跨模块复用。
 */

/**
 * 交互式 chat 渲染结果快照。
 */
export interface AgentChatInteractiveRenderSnapshot {
  /** 是否输出过面向用户可见的 assistant 文本。 */
  emitted_visible_text: boolean;
}

/**
 * 交互式 chat 渲染器协议。
 *
 * 关键点（中文）
 * - 统一约束 stdout 版与 TUI 版渲染器，直接消费 canonical Mutation。
 */
export interface AgentChatInteractiveRendererPort {
  /** 启动一轮新渲染。 */
  start_turn: () => void;

  /** 绑定当前 turn id。 */
  attach_turn_id: (turn_id: string) => void;

  /** 渲染单个 session 事件。 */
  render_event: (event: SessionMutation) => void;

  /** pending Interaction 到达时触发；stdout 版可忽略。 */
  on_interaction_request?: (request: SessionInteractionRequest) => void;

  /** 结束当前一轮渲染。 */
  finish_turn: () => AgentChatInteractiveRenderSnapshot;
}

/** Agent Chat 正在等待用户处理的一条 Session Interaction。 */
export interface AgentChatPendingInteractionView {
  /** Interaction 所属 Session 标识。 */
  session_id: string;
  /** Session 持久化的 canonical Interaction 请求。 */
  request: SessionInteractionRequest;
}

/**
 * tool 展示区块。
 */
export interface AgentChatToolDisplayBlock {
  /** tool 状态标题。 */
  title: string;
  /** tool 详细摘要行。 */
  detail_lines: string[];
}
