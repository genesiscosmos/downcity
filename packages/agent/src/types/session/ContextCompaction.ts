/** 分批上下文摘要的输入单元及可观测诊断，不持久化聊天正文副本。 */
import type { StableContextPart } from "./ContextCheckpoint.js";

/** 模型可见语义与 canonical 边界的关联。 */
export interface ContextSummaryUnit extends StableContextPart {
  /** 经统一消息投影后供摘要使用的文本，不包含 UI 数据或附件二进制。 */
  text: string;
}

/** 一次摘要批次请求的元信息；token 为保守字符估算而非 Provider 精确计数。 */
export interface ContextCompactionDiagnostic {
  /** 当前摘要模型标识。 */
  model_id: string;
  /** 本次调用的结果阶段。 */
  phase: "request" | "completed" | "failed";
  /** 实际提交的 system 与 user 文本字符总量。 */
  input_characters: number;
  /** 保守估算的输入 token 数。 */
  estimated_input_tokens: number;
  /** 本次调用允许的输入 token 预算。 */
  input_budget: number;
  /** 当前批次起始源 Message 序号。 */
  from_message_sequence: number;
  /** 当前批次终止源 Message 序号。 */
  through_message_sequence: number;
  /** 当前批次终止 Part 序号。 */
  through_part_sequence: number;
  /** 是否正在处理单个超大单元的片段。 */
  partial_unit: boolean;
  /** 失败时保留原始异常文本，避免把普通 HTTP 400 误判为超限。 */
  error?: string;
  /** 模型协议错误分类；Provider 未提供时保持缺省。 */
  error_code?: string;
  /** Provider 提供的原始请求标识，用于服务端定位；缺失时不伪造。 */
  provider_request_id?: string;
}
