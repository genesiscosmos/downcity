/**
 * 上游模型 HTTP 错误边界。
 * 限量读取供应商错误码以识别明确的上下文超限，随后取消正文；只暴露标准安全分类。
 * 提示词、上游错误正文和凭据都不进入异常信息或中转调用日志。
 */

import { read_model_error, type ModelError, type ModelErrorCode } from "@downcity/type";
import { read_bounded_error_text } from "../../shared/BoundedResponseText.js";

/** 已知上游结构化错误标识；未知标识不推测为临时故障。 */
const UPSTREAM_ERROR_CODES = new Map<string, ModelErrorCode>([
  ["rate_limit_exceeded", "rate_limited"], ["rate_limit_error", "rate_limited"], ["too_many_requests", "rate_limited"],
  ["server_error", "provider_error"], ["internal_server_error", "provider_error"],
  ["overloaded_error", "provider_error"], ["service_unavailable", "provider_error"],
  ["timeout", "provider_timeout"], ["timeout_error", "provider_timeout"],
  ["request_timeout", "provider_timeout"], ["upstream_timeout", "provider_timeout"],
  ["invalid_api_key", "authentication_failed"], ["authentication_error", "authentication_failed"],
  ["permission_denied", "permission_denied"], ["permission_error", "permission_denied"],
  ["model_not_found", "model_unavailable"], ["model_unavailable", "model_unavailable"],
  ["content_filter", "content_rejected"], ["content_policy_violation", "content_rejected"], ["safety_violation", "content_rejected"],
]);

/** 构造可跨 Downtown 边界传递的诊断错误。 */
export async function create_upstream_model_error(response: Response, api_key: string): Promise<Error> {
  const request_id = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("cf-ray");
  // 收到响应即固定服务端截止，读取错误正文和后续协议转换不能重新开始计时。
  const retry_after = response.headers.get("retry-after");
  const suggested_at = retry_after
    ? (/^\d+(?:\.\d+)?$/.test(retry_after) ? Date.now() + Number(retry_after) * 1000 : Date.parse(retry_after))
    : undefined;
  const retry_at_ms = suggested_at !== undefined && Number.isSafeInteger(Math.ceil(suggested_at))
    ? Math.max(0, Math.ceil(suggested_at)) : undefined;
  const text = await read_bounded_error_text(response.body);
  let detail: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    const value = parsed?.error ?? parsed;
    if (value && typeof value === "object" && !Array.isArray(value)) detail = value;
  } catch { /* 未知或截断正文不推测其拒绝原因。 */ }
  const model_error = classify_upstream_model_error(detail, response.status, request_id, api_key);
  const error = new Error(model_error.message);
  const retry_after_ms = retry_at_ms === undefined ? undefined : Math.max(0, retry_at_ms - Date.now());
  if (retry_at_ms !== undefined) model_error.retry_at_ms = retry_at_ms;
  return Object.assign(error, {
    statusCode: response.status, code: model_error.code, model_error,
    // 4xx（排除结果可能未知的 408）可确认拒绝；Router 仅重试其中的认证与限流错误。
    upstream_rejected: response.status >= 400 && response.status < 500 && response.status !== 408,
    ...(Number.isFinite(retry_after_ms) ? { retry_after_ms } : {}),
    ...(model_error.provider_request_id ? { provider_request_id: model_error.provider_request_id } : {}),
  });
}

/** HTTP 与 SSE 共用的上游错误分类；HTTP 状态优先，流内错误使用明确的结构化错误码。 */
export function classify_upstream_model_error(
  detail: Record<string, unknown>,
  status_code?: number,
  request_id?: string | null,
  api_key = "",
): ModelError {
  const raw_code = typeof detail.code === "string" ? detail.code : detail.type;
  const upstream_class = [detail.code, detail.type]
    .map((value) => typeof value === "string" ? UPSTREAM_ERROR_CODES.get(value.toLowerCase()) : undefined)
    .find((value) => value !== undefined);
  const code: ModelErrorCode = status_code === 401 ? "authentication_failed"
    : status_code === 403 ? "permission_denied"
    : status_code === 404 ? "model_unavailable"
    : status_code === 429 ? "rate_limited"
    : status_code === 408 || status_code === 504 ? "provider_timeout"
    : status_code !== undefined && status_code >= 500 ? "provider_error"
    : is_upstream_context_limit(detail) ? "context_length_exceeded"
    : upstream_class ?? "invalid_request";
  const message = typeof detail.message === "string" ? detail.message.slice(0, 2048).toLowerCase() : "";
  const provider_error_reason = code === "rate_limited" ? "Upstream rate limit exceeded"
    : code === "provider_error" || code === "provider_timeout" ? "Upstream temporarily unavailable"
    : status_code === 413 ? "Request body too large"
    : /unsupported (?:parameter|value)|unknown parameter|unrecognized request argument/.test(message) ? "Unsupported request parameter"
    : /invalid (?:function|tool).*schema|invalid schema for (?:function|tool)/.test(message) ? "Invalid tool schema"
    : /tool_call_id|tool calls?.*(?:response|follow)|tool.*messages?.*(?:preced|follow)/.test(message) ? "Invalid tool message sequence"
    : undefined;
  // 关键点（中文）：原始正文只参与分类；跨边界仅传递有限标识和预定义原因。
  const safe_identifier = (value: unknown): unknown => typeof value === "string" && api_key && value.includes(api_key) ? undefined : value;
  return read_model_error({ code, status_code,
    retryable: code === "rate_limited" || code === "provider_error" || code === "provider_timeout",
    provider_request_id: safe_identifier(request_id),
    provider_error_code: safe_identifier(raw_code),
    provider_error_param: safe_identifier(detail.param),
    provider_error_reason,
  })!;
}

/** 只匹配已知供应商结构及明确超限描述；HTTP 与错误 SSE 帧共用，普通 400 不命中。 */
export function is_upstream_context_limit(detail: Record<string, unknown>): boolean {
  const code = String(detail.code ?? detail.type ?? detail.status ?? "").toLowerCase();
  const message = typeof detail.message === "string" ? detail.message.slice(0, 2048).toLowerCase() : "";
  return ["context_length_exceeded", "max_context_length_exceeded", "context_window_exceeded", "too_many_tokens"].includes(code)
    || /maximum context length.{0,80}(?:tokens|exceeded)|prompt is too long|input (?:token count|tokens).{0,80}exceeds.{0,40}(?:maximum|limit)|context window.{0,40}exceeded/.test(message);
}
