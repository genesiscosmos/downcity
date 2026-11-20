/** Memory 完成反馈的持久化协议；接收方与被提炼来源分开，正文只包含有界处理结果。 */

/** 由真实调用环境固定的结果接收方。 */
export interface MemoryResultRecipient {
  /** 拥有原会话的 Agent，不能由模型自由指定。 */
  agent_id: string;
  /** 原会话持久化分区。 */
  type: string;
  /** 原会话稳定标识。 */
  session_id: string;
  /** 发起操作的原始轮次，运行时据此决定注入或恢复方式。 */
  caller_turn_id: string;
}

/** 一个调用方订阅一个 Job，终态投递与记忆提交相互独立。 */
export interface MemoryResultSubscription {
  /** Job 与接收身份确定性生成的记录标识。 */
  subscription_id: string;
  /** 所订阅的内部处理请求。 */
  job_id: string;
  /** 可信绑定的接收方。 */
  recipient: MemoryResultRecipient;
  /** 当前未确认投递的不可变事件；重试必须保持相同正文和标识。 */
  pending?: MemoryResultEvent;
  /** 最近已确认的终态代次，用于防止重复发送。 */
  delivered_generation?: string;
  /** 最后一次确认是注入原轮次，还是仅保留为可查询结果；二者不能混称送达。 */
  delivery_status?: "delivered" | "saved";
  /** 当前事件的投递尝试次数，不计入模型处理预算。 */
  attempts: number;
  /** 下次可尝试的 ISO 8601 时间。 */
  next_attempt_at?: string;
  /** 最近投递错误，不改变 Job 的成功状态。 */
  error?: string;
}

/** 固定终态结果及可重放身份，不能包含原始私有来源。 */
export interface MemoryResultEvent {
  /** 宿主注入的稳定幂等标识。 */
  delivery_id: string;
  /** 计算尝试与终态构成的代次。 */
  generation: string;
  /** 有界反馈文本，说明实际提交状态。 */
  text: string;
}
