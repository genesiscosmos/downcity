/** Session 离开活动集合的领域事件；由集合发布，宿主负责释放自己的投影。 */
export interface SessionRemovalEvent {
  /** 成功完成的操作；归档仍保留历史，删除永久移除活动会话数据。 */
  readonly action: "archived" | "deleted";
  /** 当前 Agent 内稳定的会话标识，与 type 共同组成身份。 */
  readonly session_id: string;
  /** 会话的持久化类型，取值为 chat 或 work。 */
  readonly type: string;
  /** 会话在同一分类内的具体角色；宿主需据此释放对应投影。 */
  readonly kind: string;
  /** 已装配会话的当前 Workspace；未装配或无项目上下文时省略。 */
  readonly workspace_id?: string;
}
