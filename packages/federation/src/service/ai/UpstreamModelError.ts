/**
 * 上游模型 HTTP 错误边界。
 * 限量读取供应商错误码以识别明确的上下文超限，随后取消正文；只暴露标准安全分类。
 * 提示词、上游错误正文和凭据都不进入异常信息或中转调用日志。
 */

import { read_model_error, type ModelErrorCode } from "@downcity/type";
import { read_bounded_error_text } from "../../shared/BoundedResponseText.js";

/** 构造可跨 Federation 边界传递的诊断错误。 */
export async function create_upstream_model_error(response: Response, api_key: string): Promise<Error> {
  const request_id = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("cf-ray");
  const text = await read_bounded_error_text(response.body);
  let detail: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    const value = parsed?.error ?? parsed;
    if (value && typeof value === "object" && !Array.isArray(value)) detail = value;
  } catch { /* 未知或截断正文不推测其拒绝原因。 */ }
  const context_limit = is_upstream_context_limit(detail);
  const code: ModelErrorCode = context_limit && [400, 413, 422].includes(response.status) ? "context_length_exceeded"
    : response.status === 401 ? "authentication_failed" : response.status === 403 ? "permission_denied"
    : response.status === 404 ? "model_unavailable" : response.status === 429 ? "rate_limited"
    : response.status === 408 || response.status === 504 ? "provider_timeout"
    : response.status < 500 ? "invalid_request" : "provider_error";
  const model_error = read_model_error({ code, status_code: response.status,
    retryable: response.status === 429 || response.status >= 500,
    provider_request_id: request_id && (!api_key || !request_id.includes(api_key)) ? request_id : undefined })!;
  const error = new Error(model_error.message);
  const retry_after = response.headers.get("retry-after");
  const retry_after_ms = retry_after
    ? (/^\d+(?:\.\d+)?$/.test(retry_after) ? Number(retry_after) * 1000 : Date.parse(retry_after) - Date.now())
    : undefined;
  return Object.assign(error, {
    statusCode: response.status, code: model_error.code, model_error,
    // 4xx（排除结果可能未知的 408）可确认拒绝；Router 仅重试其中的认证与限流错误。
    upstream_rejected: response.status >= 400 && response.status < 500 && response.status !== 408,
    ...(Number.isFinite(retry_after_ms) ? { retry_after_ms } : {}),
    ...(model_error.provider_request_id ? { provider_request_id: model_error.provider_request_id } : {}),
  });
}

/** 只匹配已知供应商结构及明确超限描述；HTTP 与错误 SSE 帧共用，普通 400 不命中。 */
export function is_upstream_context_limit(detail: Record<string, unknown>): boolean {
  const code = String(detail.code ?? detail.type ?? detail.status ?? "").toLowerCase();
  const message = typeof detail.message === "string" ? detail.message.slice(0, 2048).toLowerCase() : "";
  return ["context_length_exceeded", "max_context_length_exceeded", "context_window_exceeded", "too_many_tokens"].includes(code)
    || /maximum context length.{0,80}(?:tokens|exceeded)|prompt is too long|input (?:token count|tokens).{0,80}exceeds.{0,40}(?:maximum|limit)|context window.{0,40}exceeded/.test(message);
}
