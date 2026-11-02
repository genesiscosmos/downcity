/**
 * Federation HTTP 错误协议与关联信息。
 *
 * 预期 4xx 保留明确业务说明；5xx 和未知异常只返回通用消息。诊断事件只记录
 * 服务端生成的请求 ID、分类状态和稳定错误码，不记录正文、Token、异常消息或堆栈。
 */

/** 按状态选择稳定的默认分类，不信任异常中任意 type/status 字段。 */
function error_category(status: number): { /** 客户端错误分类。 */ type: string; /** 稳定错误码。 */ code: string; /** 默认可公开说明。 */ message: string } {
  if (status === 400) return { type: "invalid_request_error", code: "INVALID_REQUEST", message: "Invalid request" };
  if (status === 401) return { type: "authentication_error", code: "UNAUTHENTICATED", message: "Authentication required" };
  if (status === 403) return { type: "permission_error", code: "FORBIDDEN", message: "Permission denied" };
  if (status === 404) return { type: "not_found_error", code: "NOT_FOUND", message: "Not found" };
  if (status === 409) return { type: "conflict_error", code: "CONFLICT", message: "Request conflicts with current state" };
  if (status === 413) return { type: "invalid_request_error", code: "BODY_TOO_LARGE", message: "Request body too large" };
  if (status === 429) return { type: "rate_limit_error", code: "RATE_LIMITED", message: "Too many requests" };
  if (status < 500) return { type: "invalid_request_error", code: "REQUEST_REJECTED", message: "Request rejected" };
  if (status === 503) return { type: "server_error", code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" };
  if (status === 504) return { type: "server_error", code: "REQUEST_TIMEOUT", message: "Request timed out" };
  return { type: "server_error", code: "INTERNAL_ERROR", message: "Internal server error" };
}

/** 返回固定错误结构；只有显式合法 statusCode 才保留状态，未知异常统一 500。 */
export function build_error_response(error: unknown, request_id: string): Response {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number.isInteger(candidate.statusCode) && Number(candidate.statusCode) >= 400 && Number(candidate.statusCode) <= 599
    ? Number(candidate.statusCode) : 500;
  const category = error_category(status);
  const code = candidate.statusCode === status && typeof candidate.code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(candidate.code)
    ? candidate.code : category.code;
  const message = status < 500 && typeof candidate.message === "string" && candidate.message
    ? candidate.message : category.message;
  if (status >= 500) log_http_failure(request_id, status, code);
  return Response.json({ error: { code, message, type: category.type, request_id } }, {
    status, headers: { "x-request-id": request_id, "cache-control": "no-store" },
  });
}

/** 日志采用不含用户输入的结构，原始异常由业务自身的受控观测层处理。 */
export function log_http_failure(request_id: string, status: number, code: string): void {
  console.error(JSON.stringify({ event: "federation_http_error", request_id, status, code }));
}
