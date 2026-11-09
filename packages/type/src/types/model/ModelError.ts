/**
 * Downcity 模型错误协议模块。
 *
 * 错误只暴露稳定、安全且可操作的字段；供应商原始正文不跨越协议边界。
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

/** 稳定安全说明白名单，解码时不复用不可信的原始错误文本。 */
const MODEL_ERROR_MESSAGES: Record<ModelErrorCode, string> = {
  invalid_request: "Model request rejected; the rejection is not classified as a context limit",
  authentication_failed: "Model authentication failed", permission_denied: "Model permission denied",
  model_unavailable: "Model unavailable", rate_limited: "Model rate limit exceeded",
  context_length_exceeded: "Model context length exceeded", content_rejected: "Model content rejected",
  provider_timeout: "Model provider timed out", provider_error: "Model provider failed",
  transport_error: "Model transport failed", cancelled: "Model request cancelled", internal_error: "Model execution failed",
};

/** 从协议对象读取稳定分类；只保留白名单字段和有限长度的请求标识。 */
export function read_model_error(value: unknown): ModelError | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !Object.hasOwn(MODEL_ERROR_MESSAGES, record.code)) return undefined;
  const code = record.code as ModelErrorCode;
  const status_code = Number.isInteger(record.status_code) && Number(record.status_code) >= 400 && Number(record.status_code) <= 599
    ? Number(record.status_code) : undefined;
  const provider_request_id = typeof record.provider_request_id === "string" && /^[A-Za-z0-9_.:/-]{1,128}$/.test(record.provider_request_id)
    ? record.provider_request_id : undefined;
  return { code, message: MODEL_ERROR_MESSAGES[code],
    retryable: (code === "rate_limited" || code === "transport_error" || code === "provider_error") && record.retryable === true,
    ...(status_code ? { status_code } : {}), ...(provider_request_id ? { provider_request_id } : {}) };
}
