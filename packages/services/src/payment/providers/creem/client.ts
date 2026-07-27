/**
 * Creem HTTP / webhook 工具函数。
 *
 * 关键说明（中文）
 * - 不依赖 Creem SDK，统一走官方 HTTP API
 * - webhook 验签使用 Web Crypto API，兼容 Cloudflare Workers
 */

import { normalizeOptionalText, normalizeRequired } from "../../helpers.js";
import type {
  CreemCheckoutSessionResult,
  CreemCreateCheckoutSessionInput,
  CreemWebhookEvent,
} from "./types.js";

/**
 * 规范化 Creem API 基础地址。
 */
export function normalizeCreemApiBaseURL(value: string | undefined): string {
  const normalized = String(value ?? "https://api.creem.io/v1").trim();
  if (!normalized) throw new TypeError("Creem API server URL is required");
  return normalized.replace(/\/+$/, "");
}

/**
 * 创建 Creem Checkout Session。
 */
export async function createCreemCheckoutSession(
  api_key: string,
  api_base_url: string,
  input: CreemCreateCheckoutSessionInput,
): Promise<CreemCheckoutSessionResult> {
  const response = await fetch(`${normalizeCreemApiBaseURL(api_base_url)}/checkouts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": normalizeRequired(api_key, "Creem API key"),
    },
    body: JSON.stringify({
      product_id: input.product_id,
      success_url: input.success_url,
      request_id: input.payment_id,
      metadata: {
        payment_id: input.payment_id,
        user_id: input.payment.user_id,
        credits: input.payment.credits,
        amount_minor: input.payment.amount_minor,
      },
    }),
  });

  const payload = await readJSONRecord(response);
  if (!response.ok) {
    const message = String(
      (payload.error && typeof payload.error === "object" ? payload.error.message : "") ||
      payload.message ||
      "Creem checkout session creation failed",
    ).trim();
    throw new Error(message || "Creem checkout session creation failed");
  }

  return {
    checkout_id: normalizeRequired(payload.id ?? payload.checkout_id, "Creem checkout id"),
    checkout_url: normalizeRequired(payload.checkout_url ?? payload.url, "Creem checkout url"),
  };
}

/**
 * 解析 Creem webhook 事件。
 */
export function parseCreemWebhookEvent(raw: string): CreemWebhookEvent {
  const parsed = JSON.parse(raw || "{}");
  return parsed && typeof parsed === "object" ? parsed as CreemWebhookEvent : {};
}

/**
 * 验证 Creem webhook 签名。
 *
 * 关键说明（中文）
 * - Creem 当前 webhook header 使用 `creem-signature`
 * - 签名值是 raw body 基于 webhook secret 的 HMAC-SHA256 hex
 */
export async function verifyCreemSignature(
  raw: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const signature = normalizeOptionalText(header);
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const expected = Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(signature, expected);
}

/**
 * 读取 metadata 对象。
 */
export function readMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * 读取 Creem webhook 事件对象。
 */
export function readCreemEventObject(event: Record<string, unknown>): Record<string, unknown> {
  const direct = readMetadata(event.object);
  if (Object.keys(direct).length > 0) return direct;
  return readMetadata((event.data as { object?: unknown } | undefined)?.object);
}

/**
 * 读取支付 provider 需要的 USD cents 金额。
 */
/**
 * 常量时间比较两个签名字符串。
 */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

/**
 * 读取 JSON 响应并兜底为空对象。
 */
async function readJSONRecord(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : {};
  } catch {
    return { message: text };
  }
}
