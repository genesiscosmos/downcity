/**
 * Agent 会话的 Session 工具类型协议。
 *
 * 职责说明（中文）
 * - session 工具让 Agent 安排、继续、观察和收回同一容器中目标 Agent 的工作会话。
 * - 它们只出现在 Agent 主会话和 Channel 会话中，Work Session 不会递归派发。
 *
 * 关键点（中文）
 * - 工具不接触 Session 内部结构，只消费公开的摘要、消息投影和交互入口。
 */

import type { SessionMessagePage } from "@downcity/type";
import type { AgentArchiveSessionResult } from "@/types/agent/SessionTypes.js";

/** 分页消息输出包含完整 canonical Parts，历史仅作为参考数据。 */
export interface SessionMessagesToolOutput extends SessionMessagePage {
  /** 数据来自未裁剪的 Session 原始历史。 */
  source: "canonical_history";
  /** 历史正文不应被当成本轮用户指令。 */
  trust_level: "reference";
}

/** 归档结果沿用 SDK 的 Session 集合契约。 */
export interface SessionArchiveToolOutput extends AgentArchiveSessionResult {
  /** 会话已从活跃列表移出，历史保留。 */
  status: "archived";
}

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
  /** 会话所属 Agent 标识；后续调用应携带同一 agent_id。 */
  agent_id: string;
  /** 会话当前绑定的项目 Workspace 标识。 */
  workspace_id?: string;
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

/** `session.start` 的输出。 */
export interface SessionStartToolOutput {
  /** 新建工作会话的轻量描述，包含后续交互所需标识与当前状态。 */
  session: SessionToolSummary;
  /** 本次工作委派的稳定标识，用于结果回传关联与去重。 */
  delegation_id: string;
  /** 本次任务已提交，返回时该会话可能仍在执行。 */
  status: "started";
}

/** `session.send` 的输出；每条追加消息拥有独立的结果回传关联。 */
export interface SessionSendToolOutput {
  /** 接收本次消息的工作会话及其当前状态。 */
  session: SessionToolSummary;
  /** 本次消息的工作关联标识，用于执行去重与结果回传。 */
  delegation_id: string;
  /** 输入已提交到目标工作会话，结果稍后自动回传。 */
  status: "submitted";
}

/** `session.check` 清单模式的输出。 */
export interface SessionCheckListToolOutput {
  /** 当前 Agent 除自己那条会话外的全部会话。 */
  mode: "list";
  /** 全部会话摘要，按最近更新倒序。 */
  sessions: SessionToolSummary[];
}

/** `session.check` 详情模式的输出。 */
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
    /** Interaction 稳定标识，可交给 `session` 的 `reply` 动作。 */
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

/** `session.check` 的输出。 */
export type SessionCheckToolOutput =
  | SessionCheckListToolOutput
  | SessionCheckDetailToolOutput;

/** `session.reply` 的输出。 */
export interface SessionReplyToolOutput {
  /** 响应已提交并被目标会话接受。 */
  status: "resolved" | "denied";
  /** 目标会话标识。 */
  session_id: string;
  /** 已完成的 Interaction 标识。 */
  interaction_id: string;
}

/** `session.stop` 的输出。 */
export interface SessionStopToolOutput {
  /** 目标会话标识。 */
  session_id: string;
  /** 停止结果状态。 */
  status: "stopped";
}
