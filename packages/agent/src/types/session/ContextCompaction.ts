/** 单次上下文摘要的输入单元及可观测诊断，不持久化聊天正文副本。 */
import type { StableContextPart } from "./ContextCheckpoint.js";

/** 模型可见语义与 canonical 边界的关联。 */
export interface ContextSummaryUnit extends StableContextPart {
  /** 经统一消息投影后供摘要使用的文本，不包含 UI 数据或附件二进制。 */
  text: string;
}

/** 一次摘要请求的元信息；token 为保守字符估算而非 Provider 精确计数。 */
export interface ContextCompactionDiagnostic {
  /** 当前摘要模型标识。 */
  model_id: string;
  /** 本次调用的结果阶段。 */
  phase: "request" | "completed" | "failed";
  /** 实际提交的 system 与 user 文本字符总量。 */
  input_characters: number;
  /** 单次摘要请求的消息数量，包含 system、旧摘要、历史记录及最终要求。 */
  input_message_count: number;
  /** 保守估算的输入 token 数。 */
  estimated_input_tokens: number;
  /** 实际模型窗口扣除输出及余量后的预算；窗口未知时为 null，不设置固定上限。 */
  input_budget: number | null;
  /** 当前请求尝试序号；传输中断最多重试一次。 */
  attempt: number;
  /** 本次请求起始源 Message 序号。 */
  from_message_sequence: number;
  /** 本次请求终止源 Message 序号。 */
  through_message_sequence: number;
  /** 本次请求终止 Part 序号。 */
  through_part_sequence: number;
  /** 失败时保留原始异常文本，避免把普通 HTTP 400 误判为超限。 */
  error?: string;
  /** 模型协议错误分类；Provider 未提供时保持缺省。 */
  error_code?: string;
  /** Provider 提供的原始请求标识，用于服务端定位；缺失时不伪造。 */
  provider_request_id?: string;
}
