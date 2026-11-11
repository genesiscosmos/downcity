/** 执行结算结果；只有真正提交当前执行令牌后才允许产生终态通知。 */
export interface TaskExecutionSettlement {
  /** 本次 execution_id 是否仍属于当前任务并已成功提交。 */
  readonly applied: boolean;
  /** 成功结果是否创建了人工验收事项。 */
  readonly review: boolean;
  /** 当前执行关联的发生项身份；单次手动执行可省略。 */
  readonly occurrence_id?: string;
}
