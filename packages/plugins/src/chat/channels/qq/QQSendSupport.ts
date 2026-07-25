/**
 * QQSendSupport：QQ 回发重试与错误归因辅助。
 *
 * 关键点（中文）
 * - 这里只放与“发送失败处理”有关的纯辅助逻辑。
 * - `QQGatewayClient` 只调用这些函数，不再内嵌大段重试细节。
 */

import type { JsonObject, JsonValue } from "@downcity/agent";

/**
 * 解析 QQ API 业务错误文本。
 */
export function resolveQqApiErrorText(responseText: string): string | null {
  if (!responseText) return null;
  try {
    const parsed = JSON.parse(responseText) as JsonValue;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const payload = parsed as JsonObject;
    const codeValue = payload.code ?? payload.errcode ?? payload.retcode;
    const code =
      typeof codeValue === "number"
        ? codeValue
        : typeof codeValue === "string" && codeValue.trim()
          ? Number(codeValue)
          : undefined;
    if (!Number.isFinite(code) || code === 0) return null;
    const messageCandidates = [payload.message, payload.msg, payload.error, payload.errmsg]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    const detail = messageCandidates[0] || responseText.slice(0, 200);
    return `API code ${code}${detail ? `: ${detail}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * 判断一次发送失败是否值得自动重试。
 */
export function isRetryableQqSendFailure(errorText: string): boolean {
  const text = String(errorText || "").toLowerCase();
  if (!text) return false;
  if (
    text.includes("http 400") ||
    text.includes("http 404") ||
    text.includes("requires chattype + messageid") ||
    (text.includes("unknown") && text.includes("chat") && text.includes("type")) ||
    text.includes("未知的聊天类型") ||
    text.includes("msg_id") ||
    text.includes("messageid") ||
    text.includes("message id")
  ) {
    return false;
  }

  return (
    text.includes("http 401") ||
    text.includes("http 403") ||
    text.includes("http 408") ||
    text.includes("http 429") ||
    text.includes("http 5") ||
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("socket") ||
    text.includes("econn") ||
    text.includes("etimedout") ||
    text.includes("eai_again") ||
    text.includes("enotfound")
  );
}

/**
 * 发送重试前等待一段退避时间。
 */
export async function waitBeforeQqSendRetry(attempt: number): Promise<void> {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.trunc(attempt) : 1;
  const delay_ms = Math.min(4000, 600 * 2 ** (safeAttempt - 1));
  const jitterMs = Math.floor(Math.random() * 180);
  await sleepMs(delay_ms + jitterMs);
}

/**
 * Promise 版 sleep。
 */
async function sleepMs(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.trunc(ms));
  });
}
