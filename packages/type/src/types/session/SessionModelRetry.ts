/** 当前执行的手动 Retry 动作协议；绑定只存在于运行时，不保存尝试历史。 */

/** 当前进程内仍可恢复的错误位置；由 Session.status 投影。 */
export interface SessionModelRetry {
  /** 当前失败步骤所在的 canonical 消息。 */
  message_id: string;
  /** 当前错误 Part；每次失败重新分配，旧按钮无法重放。 */
  error_part_id: string;
}

/** 手动重试的最小输入，不接受正文、恢复提示词或历史步骤。 */
export interface SessionModelRetryInput {
  /** 原失败消息身份。 */
  message_id: string;
  /** 当前运行时绑定的错误 Part，阻止失效按钮重复提交。 */
  error_part_id: string;
}

/** 当前执行对动作的接收结果。 */
export interface SessionModelRetryResult {
  /** 是否已清除当前错误并唤醒原执行步骤。 */
  accepted: boolean;
  /** 明确未接收时的原因；传输未知时读取 Session 当前运行状态。 */
  reason?: string;
}
