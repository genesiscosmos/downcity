/** 同 Turn 原失败 Step 的 Retry 协议；绑定只存在于运行时，不保存尝试历史。 */

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

/** 新执行对动作的接收结果。 */
export interface SessionModelRetryResult {
  /** 是否接受继续原 Turn 的失败 Step。 */
  accepted: boolean;
  /** 明确未接收时的原因；传输未知时读取 Session 当前运行状态。 */
  reason?: string;
  /** 本次方法调用的完成快照；不改变先前调用已经返回的结果。 */
  result?: {
    /** 原逻辑 Turn 标识。 */ turn_id: string;
    /** 当前完整回答正文。 */ text: string;
    /** 本次调用是否成功。 */ success: boolean;
    /** 本次失败说明。 */ error?: string;
  };
}
