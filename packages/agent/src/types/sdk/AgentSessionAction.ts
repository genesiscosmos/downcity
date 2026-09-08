/**
 * Agent Session action 公开类型。
 *
 * 关键点（中文）
 * - Action 运行事件由 Session 收口为 canonical `SessionAgentActionPart`。
 * - Action 不进入模型输入。
 */

import type {
  SessionActionEvent,
  SessionActionStatus,
} from "@downcity/type";

/**
 * Session action 当前状态。
 */
export type AgentSessionActionState = SessionActionStatus;

/**
 * Session action 记录。
 */
export type AgentSessionActionRecord = SessionActionEvent;

/**
 * Session action 订阅事件。
 */
export type AgentSessionActionEvent = SessionActionEvent;

/**
 * Session action 发布回调。
 */
export type AgentSessionActionCallback = (
  action: AgentSessionActionEvent,
) => Promise<void>;
