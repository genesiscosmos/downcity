/**
 * Stripe HTTP / webhook 工具函数。
 *
 * 关键说明（中文）
 * - 不直接依赖 Stripe SDK，统一走官方 HTTP API
 * - 创建 Checkout 使用 form-urlencoded，兼容 Node 与 Worker
 * - webhook 验签使用 Web Crypto API，支持 Cloudflare Workers
 */

import { normalizeOptionalText, normalizeRequired } from "../../helpers.js";
import type {
  StripeCheckoutSessionResult,
  StripeCreateCheckoutSessionInput,
  StripeWebhookEvent,
} from "./types.js";

/**
 * 规范化 Stripe API 基础地址。
 */
export function normalizeStripeApiBaseURL(value: string | undefined): string {
  const normalized = String(value ?? "https://api.stripe.com/v1").trim();
  if (!normalized) throw new TypeError("Stripe API server URL is required");
  return normalized.replace(/\/+$/, "");
}

/**
 * 创建 Stripe Checkout Session。
 */
export async function createStripeCheckoutSession(
  secret_key: string,
  api_base_url: string,
  input: StripeCreateCheckoutSessionInput,
): Promise<StripeCheckoutSessionResult> {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", input.success_url);
  body.set("cancel_url", input.cancel_url);
  body.set("client_reference_id", input.payment.payment_id);
  body.set("metadata[payment_id]", input.payment_id);
  body.set("metadata[user_id]", input.payment.user_id);
  body.set("line_items[0][price_data][currency]", input.currency);
  body.set("line_items[0][price_data][product_data][name]", input.item_name);
  body.set("line_items[0][price_data][unit_amount]", String(input.payment.amount_minor));
  body.set("line_items[0][quantity]", "1");
  body.set("payment_intent_data[metadata][payment_id]", input.payment_id);
  body.set("payment_intent_data[metadata][user_id]", input.payment.user_id);

  const response = await fetch(`${normalizeStripeApiBaseURL(api_base_url)}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${normalizeRequired(secret_key, "Stripe secret key")}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": input.payment_id,
    },
    body,
  });

  const payload = await readJSONRecord(response);
  if (!response.ok) {
    const message = String(
      (payload.error && typeof payload.error === "object" ? payload.error.message : "") ||
      payload.message ||
      "Stripe checkout session creation failed",
    ).trim();
    throw new Error(message || "Stripe checkout session creation failed");
  }

  return {
    session_id: normalizeRequired(payload.id, "Stripe checkout session id"),
    checkout_url: normalizeRequired(payload.url, "Stripe checkout session url"),
    payment_intent_id: normalizeOptionalText(payload.payment_intent),
  };
}

/**
 * 解析 Stripe webhook 事件。
 */
export function parseStripeWebhookEvent(raw: string): StripeWebhookEvent {
  const parsed = JSON.parse(raw || "{}");
  return parsed && typeof parsed === "object" ? parsed as StripeWebhookEvent : {};
}

/**
 * 验证 Stripe webhook 签名。
 */
export async function verifyStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${raw}`));
  const expected = Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (signature.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < signature.length; index++) {
    result |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
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
 * 读取支付 provider 需要的 USD cents 金额。
 */
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
