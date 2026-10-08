/**
 * 主对话的 Session 工具类型协议。
 *
 * 职责说明（中文）
 * - 这四个工具让 Agent 在自己的对话里安排、观察和收回其他会话。
 * - 它们只出现在主对话的会话上下文中，普通 Session 拿不到，因此不会递归派发。
 *
 * 关键点（中文）
 * - 工具不接触 Session 内部结构，只消费公开的摘要、消息投影和交互入口。
 */

/**
 * 一条会话在清单中暴露的稳定状态。
 *
 * 说明（中文）：清单只投影可从轻量摘要与内存运行态得到的状态；失败原因属于详情，
 * 需要读取该会话的消息，因此不在此列。
 */
export type SessionToolState =
  | "running"
  | "waiting_for_user"
  | "idle";

/** 清单里的一条会话摘要。 */
export interface SessionToolSummary {
  /** 会话稳定标识。 */
  session_id: string;
  /** 用户可见标题；未生成时省略。 */
  title?: string;
  /** 当前状态。 */
  state: SessionToolState;
  /** 最近更新的预览文本；用于让对话判断这条活是什么。 */
  preview_text?: string;
  /** 最近更新时间戳（ms）。 */
  updated_at?: number;
  /** 当前正在等待用户响应的 Interaction 数量。 */
  pending_interaction_count: number;
}

/** `session_start` 的输出。 */
export interface SessionStartToolOutput {
  /** 新建会话的稳定标识。 */
  session_id: string;
  /** 本次任务已提交，返回时该会话可能仍在执行。 */
  status: "started";
}

/** `session_check` 清单模式的输出。 */
export interface SessionCheckListToolOutput {
  /** 当前 Agent 除主对话外的全部会话。 */
  mode: "list";
  /** 全部会话摘要，按最近更新倒序。 */
  sessions: SessionToolSummary[];
}

/** `session_check` 详情模式的输出。 */
export interface SessionCheckDetailToolOutput {
  /** 本次读取的是单条会话。 */
  mode: "detail";
  /** 该会话摘要。 */
  session: SessionToolSummary;
  /** 最近的消息投影，用于回答「它做了什么」。 */
  messages: Array<{
    /** 消息角色。 */
    role: "user" | "agent";
    /** 已归一化的纯文本内容。 */
    text: string;
  }>;
  /** 当前等待用户响应的 Interaction；为空表示不需要用户介入。 */
  pending_interactions: Array<{
    /** Interaction 稳定标识，可交给 `session_reply`。 */
    interaction_id: string;
    /** Interaction 业务类型，例如 question 或 approval。 */
    type: string;
    /** 面向用户的展示标题。 */
    title?: string;
    /** 面向用户的展示描述。 */
    description?: string;
  }>;
  /** 该会话最近一个 Turn 的失败文本；成功时为省略。 */
  failure?: string;
}

/** `session_check` 的输出。 */
export type SessionCheckToolOutput =
  | SessionCheckListToolOutput
  | SessionCheckDetailToolOutput;

/** `session_reply` 的输出。 */
export interface SessionReplyToolOutput {
  /** 响应已提交并被目标会话接受。 */
  status: "resolved" | "denied";
  /** 目标会话标识。 */
  session_id: string;
  /** 已完成的 Interaction 标识。 */
  interaction_id: string;
}

/** `session_stop` 的输出。 */
export interface SessionStopToolOutput {
  /** 目标会话标识。 */
  session_id: string;
  /** 停止结果状态。 */
  status: "stopped";
}
