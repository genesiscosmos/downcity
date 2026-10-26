/**
 * 上游模型 HTTP 错误边界。
 * 只保留状态、请求标识和恢复所需的 Retry-After，立即取消错误正文。
 * 提示词、上游错误正文和凭据都不进入异常信息或中转调用日志。
 */

/** 构造可跨 Federation 边界传递的诊断错误。 */
export async function create_upstream_model_error(response: Response, _api_key: string): Promise<Error> {
  const request_id = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("cf-ray");
  await response.body?.cancel().catch(() => undefined);
  const messages: Record<number, string> = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    408: "Request Timeout", 429: "Too Many Requests", 500: "Internal Server Error",
    502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
  };
  const error = new Error(messages[response.status] ?? "Upstream model request failed");
  const retry_after = response.headers.get("retry-after");
  const retry_after_ms = retry_after
    ? (/^\d+(?:\.\d+)?$/.test(retry_after) ? Number(retry_after) * 1000 : Date.parse(retry_after) - Date.now())
    : undefined;
  return Object.assign(error, {
    statusCode: response.status,
    // 4xx（排除结果可能未知的 408）可确认拒绝；Router 仅重试其中的认证与限流错误。
    upstream_rejected: response.status >= 400 && response.status < 500 && response.status !== 408,
    ...(Number.isFinite(retry_after_ms) ? { retry_after_ms } : {}),
    ...(request_id ? { provider_request_id: request_id } : {}),
  });
}
