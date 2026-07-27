/**
 * city agent chat TUI 内部数据类型。
 *
 * 关键点（中文）
 * - 只定义 Chat TUI 自己拥有的交互状态。
 * - 会话消息直接使用 @downcity/agent 的 canonical SessionMessage，不在此复制。
 */

import type { SessionApprovalModeSnapshot } from "@downcity/agent";

/** Agent Chat 审批面板所需的规范化请求详情。 */
export interface AgentChatApprovalView {
  /** 当前审批所属 Session 标识。 */
  session_id: string;
  /** 稳定审批 ID。 */
  approval_id: string;
  /** 发起审批的工具名称。 */
  tool_name: string;
  /** 待执行命令或输入内容。 */
  cmd: string;
  /** 待执行操作的工作目录。 */
  cwd: string;
  /** 申请 unrestricted 执行的业务原因。 */
  reason: string;
}

/**
 * 当前 TUI 本地排队的用户输入。
 *
 * 关键点（中文）
 * - 排队输入尚未提交到远端 Session，因此不会被当前 Turn 合并为 steer。
 * - 协调器在当前 Turn 成功结束后按 FIFO 顺序把它们作为独立 Turn 提交。
 */
export interface QueuedInput {
  /** 仅在当前 TUI 进程内唯一的排队条目 ID。 */
  id: string;
  /** 用户提交的、已标准化的完整输入文本。 */
  text: string;
}

/**
 * TUI 应用状态。
 */
export interface AppState {
  /** 当前 agent id。 */
  agent_id: string;

  /** 当前 session id。 */
  session_id: string;

  /** 当前 Session configured 与 effective 审批模式快照；加载前为空。 */
  approval_mode?: SessionApprovalModeSnapshot;

  /**
   * 当前 session 可读标题。
   *
   * 关键点（中文）
   * - 由远程 session 的 `AgentSessionInfo.title` 提供。
   * - 标题可能为空，UI 层需回退到占位文案。
   */
  session_title?: string;

  /** 是否正在等待助手回复。 */
  is_executing: boolean;

  /** 当前 TUI 本地等待发送的消息数量。 */
  queued_message_count: number;

  /**
   * Transcript 相对最新内容向上偏移的行数。
   * 0 表示跟随最新消息，大于 0 表示用户正在查看历史。
   */
  transcript_scroll_offset: number;
}
