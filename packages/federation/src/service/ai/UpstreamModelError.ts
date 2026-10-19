/**
 * 上游模型 HTTP 错误诊断边界。
 * 保留状态、请求标识和受限正文，支持 JSON、文本和 HTML 错误；不记录请求或认证头。
 * 返回正文前移除当前凭据及常见认证形式，避免错误回显泄露密钥。
 */

/** 构造可跨 Federation 边界传递的诊断错误。 */
export async function create_upstream_model_error(response: Response, api_key: string): Promise<Error> {
  const request_id = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("cf-ray");
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (reader && body.length < 16_384) {
      const item = await reader.read();
      if (item.done) break;
      body += decoder.decode(item.value.subarray(0, 16_384), { stream: true });
    }
    body += decoder.decode();
  } catch {
    // 错误响应自身读取失败时仍保留已读正文与 HTTP 状态。
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
  let safe_body = body;
  if (api_key) safe_body = safe_body.split(api_key).join("[redacted]");
  safe_body = safe_body
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|access[_-]?token|authorization)["']?\s*[:=]\s*["']?)[^\s"'<> ,}]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  const detail = safe_body.trim().slice(0, 2_048);
  const error = new Error([
    `Upstream model HTTP ${response.status}`,
    request_id ? `request_id=${request_id.replace(/[\r\n]/g, " ").slice(0, 200)}` : "",
    detail ? `response=${detail}` : "response body is empty",
  ].filter(Boolean).join("; "));
  return Object.assign(error, { statusCode: response.status, ...(request_id ? { provider_request_id: request_id } : {}) });
}
