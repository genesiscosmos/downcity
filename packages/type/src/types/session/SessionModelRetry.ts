/** 模型步骤尝试与手动重试的持久化控制协议；这些记录不属于模型对话。 */
import type { ModelError } from "../model/ModelError.js";

/** 单次实际 Provider 请求的不可变诊断结果。 */
export interface SessionModelAttempt {
  /** 此次请求的稳定身份，亦用作失败锚点。 */
  attempt_id: string;
  /** 请求开始的 Unix 毫秒时间。 */
  started_at: number;
  /** 请求结束的 Unix 毫秒时间。 */
  ended_at: number;
  /** 完整响应已提交、失败、被取消或进程中断。 */
  outcome: "committed" | "failed" | "stopped" | "interrupted";
  /** SDK 归一化并脱敏的模型错误。 */
  error?: ModelError;
  /** 未提交正文，仅用于错误详情和未完成输出展示。 */
  partial_text?: string;
  /** 未提交推理，仅用于诊断，不进入后续上下文。 */
  partial_reasoning?: string;
}

/** 一次已经可靠接收的手动控制动作。 */
export interface SessionModelRetryReceipt {
  /** 客户端在发送前固定的幂等身份。 */
  request_id: string;
  /** 此动作恢复的失败尝试身份。 */
  failure_attempt_id: string;
  /** 运行时接收的 Unix 毫秒时间。 */
  accepted_at: number;
}

/** 同一个模型步骤的权威尝试记录，保存在原错误 Part 内。 */
export interface SessionModelRetry {
  /** 原任务的 Turn 身份，手动重试始终沿用。 */
  turn_id: string;
  /** 本模型步骤的稳定身份。 */
  step_id: string;
  /** 请求所用模型身份。 */
  model_id: string;
  /** 最终请求持久依据所在的 canonical data Part 身份。 */
  input_part_id?: string;
  /** 已开始但尚未结算的真实请求，用于进程中断诊断。 */
  active_attempt?: {
    /** 此次实际调用身份。 */
    attempt_id: string;
    /** 请求开始的 Unix 毫秒时间。 */
    started_at: number;
  };
  /** 当前步骤恢复状态；成功只表示模型响应已提交。 */
  status: "failed" | "running" | "succeeded" | "stopped" | "superseded" | "interrupted";
  /** 当前是否允许直接重试原请求。 */
  recoverable: boolean;
  /** 不可恢复或中断时需要处理的具体条件。 */
  reason?: string;
  /** 按真实请求顺序追加的尝试结果，不改写历史项。 */
  attempts: SessionModelAttempt[];
  /** 已可靠接收的控制请求，用于跨窗口去重和回执确认。 */
  receipts: SessionModelRetryReceipt[];
}

/** 手动重试或确认接收的最小输入，不接受恢复正文。 */
export interface SessionModelRetryInput {
  /** 原失败消息身份。 */
  message_id: string;
  /** 最新失败尝试身份，阻止历史按钮重放。 */
  failure_attempt_id: string;
  /** 由客户端保存并复用的控制请求身份。 */
  request_id: string;
  /** 只查询接收结果，绝不创建新的模型请求。 */
  confirm_only?: boolean;
}

/** 重试接收或确认结果。 */
export interface SessionModelRetryResult {
  /** 此请求是否已经可靠接收。 */
  accepted: boolean;
  /** 当前权威步骤记录；不存在时省略。 */
  retry?: SessionModelRetry;
  /** 明确未接收时的原因；异常表示结果未知，应使用原 ID 确认。 */
  reason?: string;
}
