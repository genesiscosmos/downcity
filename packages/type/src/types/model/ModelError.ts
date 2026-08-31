/**
 * Downcity 模型错误协议模块。
 *
 * 错误只暴露稳定、安全且可操作的字段，Provider 原始响应仅进入服务端受控日志。
 */

/** Downcity 稳定模型错误代码。 */
export type ModelErrorCode =
  | "invalid_request"
  | "authentication_failed"
  | "permission_denied"
  | "model_unavailable"
  | "rate_limited"
  | "context_length_exceeded"
  | "content_rejected"
  | "provider_timeout"
  | "provider_error"
  | "transport_error"
  | "cancelled"
  | "internal_error";

/** 可跨进程传输的标准模型错误。 */
export interface ModelError {
  /** Downcity 稳定错误代码。 */
  code: ModelErrorCode;
  /** 可安全展示给调用方的错误说明。 */
  message: string;
  /** 调用方是否可以安全重试。 */
  retryable: boolean;
  /** 可选上游 HTTP 状态码。 */
  status_code?: number;
  /** 可选上游请求 ID。 */
  provider_request_id?: string;
}
