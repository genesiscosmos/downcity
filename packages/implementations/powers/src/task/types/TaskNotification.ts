/** Task 状态提交后的业务通知协议；宿主渠道不持有任务或应用内未读状态。 */
export interface TaskNotification {
  /** 任务内稳定事件身份；同一业务事实重试时保持不变。 */
  readonly event_id: string;
  /** City 内稳定的任务身份，不随标题变化。 */
  readonly task_id: string;
  /** 已提交事实的业务含义；成功与等待人工验收明确区分。 */
  readonly kind: "reminder" | "review" | "success" | "failure" | "trigger_failure" | "missed";
  /** 用户可见标题，不包含完整执行正文。 */
  readonly title: string;
  /** 可选短摘要，失败详情在事件构造时裁剪。 */
  readonly body?: string;
  /** 本事件所属的周期发生项身份。 */
  readonly occurrence_id?: string;
  /** 确实已持久化的执行记录时间戳；没有记录时省略。 */
  readonly run_timestamp?: string;
}

/** 宿主可选提供的通知展示渠道，生命周期由宿主负责。 */
export interface TaskNotificationChannel {
  /** 提交通知请求；完成仅表示受理，不表示系统已展示或用户已查看。 */
  send(notification: TaskNotification): void | Promise<void>;
}
