/**
 * DeepSeek Search / Fetch 共用的 JSON 请求边界。
 *
 * 两种能力使用同一官方 endpoint 和 Bearer Key；请求沿用 Web 的超时与响应大小限制。
 * 仅针对 HTTP 408、429、5xx 最多重试两次，遵守 Retry-After 或使用带抖动的指数退避。
 * 全部请求与退避共用一次总超时；错误只暴露操作名和状态码，不包含响应正文或凭据。
 */

import { setTimeout as delay } from "node:timers/promises";
import type { DeepSeekProviderOptions } from "@/web/types/WebProviderOptions.js";
import { safe_fetch } from "@/web/providers/WebHttp.js";

/** 调用官方只读工具接口，返回待 Provider 校验的 JSON。 */
export async function request_deepseek(
  operation: "search" | "fetch",
  body: Readonly<Record<string, unknown>>,
  options: DeepSeekProviderOptions,
): Promise<unknown> {
  const timeout_ms = Number.isFinite(options.timeout_ms)
    ? Math.min(60_000, Math.max(1_000, Math.floor(options.timeout_ms ?? 30_000)))
    : 30_000;
  const deadline = Date.now() + timeout_ms;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeout_ms);
  const request_body = JSON.stringify(body);
  try {
    for (let attempt = 0; ; attempt += 1) {
      controller.signal.throwIfAborted();
      const response = await safe_fetch(`https://api.deepseek.com/v1/tools/${operation}`, {
        method: "POST",
        trusted_endpoint: true,
        timeout_ms,
        signal: controller.signal,
        max_response_bytes: options.max_response_bytes,
        headers: {
          authorization: `Bearer ${options.api_key.trim()}`,
          "content-type": "application/json",
        },
        body: request_body,
      });
      controller.signal.throwIfAborted();
      if (response.status === 200) {
        try {
          return JSON.parse(response.text) as unknown;
        } catch {
          throw new Error(`DeepSeek ${operation} returned invalid JSON`);
        }
      }
      const error = new Error(`DeepSeek ${operation} failed with HTTP ${response.status}`);
      const retryable = response.status === 408 || response.status === 429
        || response.status >= 500 && response.status <= 599;
      if (!retryable || attempt >= 2) throw error;
      const delay_ms = retry_delay_ms(response.retry_after, attempt);
      // 服务端要求的等待超过剩余预算时保留最后的 HTTP 错误，不提前重试。
      if (delay_ms >= deadline - Date.now()) throw error;
      await delay(delay_ms, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`DeepSeek ${operation} timed out after ${timeout_ms} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** 优先使用 Retry-After 的秒数或 HTTP 日期，否则采用 500/1000 ms 基数与随机抖动。 */
function retry_delay_ms(retry_after: string | null, attempt: number): number {
  if (retry_after !== null) {
    const value = retry_after.trim();
    if (/^\d+(?:\.\d+)?$/u.test(value)) return Number(value) * 1_000;
    const retry_at = Date.parse(value);
    if (Number.isFinite(retry_at)) return Math.max(0, retry_at - Date.now());
  }
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}
