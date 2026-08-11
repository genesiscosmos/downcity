/**
 * `city agent chat` CLI 类型。
 *
 * 关键点（中文）
 * - 统一覆盖交互式持续对话与一次性消息两种入口。
 * - 默认使用独立的 local-cli 会话，避免与控制面 UI 上下文互相污染。
 */

import type { SessionInteractionRequest } from "@downcity/agent";

/**
 * `city agent chat` 默认使用的 local-cli 会话 ID。
 */
export const AGENT_CHAT_DEFAULT_SESSION_ID = "local-cli-chat-main";

/**
 * `city agent chat --new-session` 生成的 session ID 前缀。
 */
export const AGENT_CHAT_NEW_SESSION_ID_PREFIX = "local-cli-chat";

/**
 * `city agent chat` 命令选项。
 */
export interface AgentChatCliOptions {
  /** 目标 agent id。 */
  to?: string;
  /** 一次性发送的消息文本。 */
  message?: string;
  /**
   * 显式指定要进入或复用的 session_id。
   *
   * 关键点（中文）：该字段来自 commander 的 `--session-id` camelCase 映射。
   */
  session_id?: string;
  /** 是否新建一个独立 session 后进入 chat。 */
  newSession?: boolean;
  /** 是否输出 JSON。 */
  json?: boolean;
  /** 覆盖目标 RPC host。 */
  host?: string;
  /** 覆盖目标 RPC port。 */
  port?: number;
}

/**
 * SDK prompt 结果片段。
 */
export interface AgentChatExecuteResult {
  /** 本轮执行是否成功。 */
  success?: boolean;
  /** 面向用户可直接阅读的回复文本。 */
  userVisible?: string;
  /** 错误信息。 */
  error?: string;
}

/**
 * SDK prompt 响应体。
 */
export interface AgentChatExecuteResponse {
  /** 本轮 chat 执行是否成功。 */
  success: boolean;
  /** 实际执行使用的 session_id。 */
  session_id?: string;
  /** 执行结果。 */
  result?: AgentChatExecuteResult;
  /** 顶层错误信息。 */
  error?: string;
}

/**
 * 复用 chat transport 时的基础选项。
 */
export interface AgentChatTransportOptions {
  /** 覆盖目标 RPC host。 */
  host?: string;
  /** 覆盖目标 RPC port。 */
  port?: number;
}

/**
 * chat session 解析选项。
 */
export interface AgentChatSessionOptions {
  /** 显式指定要进入或复用的 session_id。 */
  session_id?: string;
  /** 是否新建一个独立 session。 */
  newSession?: boolean;
}

/**
 * 交互式 chat session 选项。
 */
export interface AgentChatSessionChoice {
  /** 当前选项类型。 */
  kind: "create" | "session";
  /** 选中后要使用的 session_id。 */
  session_id?: string;
}

/**
 * TUI 内展示的 session 摘要。
 */
export interface AgentChatSessionSummaryView {
  /** 当前 session_id。 */
  session_id: string;
  /** 可读标题。 */
  title?: string;
  /** 最近预览文本。 */
  preview_text?: string;
  /** 已落盘消息数。 */
  message_count: number;
  /** 最近更新时间（ms）。 */
  updated_at?: number;
  /** 是否正在执行。 */
  executing?: boolean;
}

/** TUI 当前排队展示的一条 Session Interaction。 */
export interface AgentChatPendingInteractionView {
  /** Interaction 所属 Session 标识。 */
  session_id: string;
  /** Session 持久化的 canonical Interaction 请求。 */
  request: SessionInteractionRequest;
}

/**
 * 单轮 chat 执行结果。
 */
export interface AgentChatExecutionOutcome {
  /** 目标 agent id。 */
  agent_id: string;
  /** 目标 agent 项目根目录。 */
  project_root?: string;
  /** 实际执行使用的 session_id。 */
  session_id: string;
  /** 请求是否成功。 */
  success: boolean;
  /** 执行结果响应体。 */
  payload?: AgentChatExecuteResponse;
  /** 失败时的错误文本。 */
  error?: string;
}
