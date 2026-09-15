/**
 * Session Action 跨包运行事件协议。
 *
 * Action 事件描述尚未持久化或正在更新的领域事实；`SessionMessages` 负责把它收口为
 * canonical `SessionAgentActionPart`。该协议不属于模型消息。
 */

/** Session Action 生命周期状态。 */
export type SessionActionStatus = "running" | "completed" | "failed";

/** Session Action 运行事件。 */
export interface SessionActionEvent {
  /** 同一 Action 生命周期内稳定复用的标识；由调用方提供，使同一 Action 的多次事件落到同一条 canonical Part。 */
  action_id: string;
  /** Action 的业务类别。 */
  action_type: string;
  /** Action 所属 Turn；独立 Session 操作允许省略。 */
  turn_id?: string;
  /** Action 的用户可读标题。 */
  title: string;
  /** Action 的可选用户可读说明。 */
  description?: string;
  /** Action 当前生命周期状态。 */
  status: SessionActionStatus;
}
