/**
 * Downcity 模型错误协议模块。
 *
 * 错误只暴露稳定、安全且可操作的字段；供应商原始正文不跨越协议边界。
 */

import type { ModelTimeoutPhase } from "./ModelStreamPolicy.js";

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
  /** 故障是否具备暂时性恢复语义；调用方仍须检查已发布内容和副作用。 */
  retryable: boolean;
  /** 可选上游 HTTP 状态码。 */
  status_code?: number;
  /** 超时所属阶段，恢复总预算耗尽与用户取消保持独立分类。 */
  timeout_phase?: ModelTimeoutPhase;
  /** 服务端建议的下一次尝试 Unix 毫秒时间，跨层传递时不得重新开始计时。 */
  retry_at_ms?: number;
  /** 可选上游请求 ID。 */
  provider_request_id?: string;
  /** 上游结构化错误码；只允许有限长度的协议标识，不包含原始正文。 */
  provider_error_code?: string;
  /** 被拒绝的请求参数路径；不包含参数值。 */
  provider_error_param?: string;
  /** 经过白名单归一化的原因摘要，不复用供应商原始描述。 */
  provider_error_reason?: string;
}

/** 稳定安全说明白名单，解码时不复用不可信的原始错误文本。 */
const MODEL_ERROR_MESSAGES: Record<ModelErrorCode, string> = {
  invalid_request: "Model request rejected",
  authentication_failed: "Model authentication failed", permission_denied: "Model permission denied",
  model_unavailable: "Model unavailable", rate_limited: "Model rate limit exceeded",
  context_length_exceeded: "Model context length exceeded", content_rejected: "Model content rejected",
  provider_timeout: "Model provider timed out", provider_error: "Model provider failed",
  transport_error: "Model transport failed", cancelled: "Model request cancelled", internal_error: "Model execution failed",
};

/** 可公开传输的原因摘要白名单；未知原因只保留错误分类。 */
const PROVIDER_ERROR_REASONS = new Set([
  "Unsupported request parameter", "Invalid tool schema", "Invalid tool message sequence",
  "Request body too large", "Upstream temporarily unavailable", "Upstream rate limit exceeded",
]);

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
  const provider_error_code = read_error_identifier(record.provider_error_code);
  const provider_error_param = read_error_identifier(record.provider_error_param);
  const provider_error_reason = typeof record.provider_error_reason === "string" && PROVIDER_ERROR_REASONS.has(record.provider_error_reason)
    ? record.provider_error_reason : undefined;
  const timeout_phase = code === "provider_timeout" && ["connect", "first_output", "idle", "total", "recovery_budget"].includes(String(record.timeout_phase))
    ? record.timeout_phase as ModelTimeoutPhase : undefined;
  const retry_at_ms = Number.isSafeInteger(record.retry_at_ms) && Number(record.retry_at_ms) >= 0
    ? Number(record.retry_at_ms) : undefined;
  return { code, message: timeout_phase === "recovery_budget" ? "Model recovery budget exhausted" : MODEL_ERROR_MESSAGES[code],
    ...(timeout_phase ? { timeout_phase } : {}), ...(retry_at_ms !== undefined ? { retry_at_ms } : {}),
    retryable: (code === "rate_limited" || code === "transport_error" || code === "provider_error" || code === "provider_timeout") && record.retryable === true,
    ...(status_code ? { status_code } : {}), ...(provider_request_id ? { provider_request_id } : {}),
    ...(provider_error_code ? { provider_error_code } : {}),
    ...(provider_error_param ? { provider_error_param } : {}),
    ...(provider_error_reason ? { provider_error_reason } : {}) };
}

/** 只接收结构化错误码和参数路径；拒绝自由文本、URL 和超长内容。 */
function read_error_identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,95}$/.test(value) ? value : undefined;
}
