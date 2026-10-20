/** Session 离开活动集合的领域事件；由集合发布，宿主负责释放自己的投影。 */
export interface SessionRemovalEvent {
  /** 成功完成的操作；归档仍保留历史，删除永久移除活动会话数据。 */
  readonly type: "archived" | "deleted";
  /** 当前 Agent 内稳定的会话标识，与 origin_type 共同组成身份。 */
  readonly session_id: string;
  /** 会话的持久化来源分区，不能仅按 session_id 匹配。 */
  readonly origin_type: string;
  /** 已装配会话的当前 Workspace；未装配或无项目上下文时省略。 */
  readonly workspace_id?: string;
}
