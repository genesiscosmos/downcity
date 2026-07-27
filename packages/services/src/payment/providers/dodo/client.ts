/**
 * Dodo Payments SDK 工具函数。
 *
 * 关键说明（中文）
 * - 创建 Checkout 使用官方 `dodopayments` SDK
 * - webhook 验签使用 SDK 自带 standardwebhooks unwrap
 */

import DodoPayments from "dodopayments";
import { normalizeOptionalText, normalizeRequired } from "../../helpers.js";
import type {
  DodoCheckoutSessionResult,
  DodoCreateCheckoutSessionInput,
  DodoPaymentEnvironment,
  DodoWebhookEvent,
} from "./types.js";

/**
 * 创建 Dodo SDK client。
 */
export function createDodoClient(input: {
  /** Dodo API key。 */
  api_key: string;
  /** Webhook signing key。 */
  webhook_key?: string;
  /** SDK 运行环境。 */
  environment: DodoPaymentEnvironment;
  /** 可选 API 基础地址。 */
  api_base_url?: string;
}): DodoPayments {
  const api_base_url = normalizeOptionalText(input.api_base_url);
  return new DodoPayments({
    bearerToken: normalizeRequired(input.api_key, "Dodo API key"),
    webhookKey: normalizeOptionalText(input.webhook_key) || null,
    ...(api_base_url ? { baseURL: api_base_url } : { environment: input.environment }),
  });
}

/**
 * 创建 Dodo Checkout Session。
 */
export async function createDodoCheckoutSession(
  client: DodoPayments,
  input: DodoCreateCheckoutSessionInput,
): Promise<DodoCheckoutSessionResult> {
  const response = await client.checkoutSessions.create({
    product_cart: [{
      product_id: input.product_id,
      quantity: 1,
      amount: input.payment.amount_minor,
    }],
    billing_currency: input.currency.toUpperCase() as any,
    return_url: input.return_url,
    cancel_url: input.cancel_url,
    metadata: {
      payment_id: input.payment_id,
      user_id: input.payment.user_id,
      credits: String(input.payment.credits),
      amount_minor: String(input.payment.amount_minor),
    },
  }, {
    idempotencyKey: input.payment_id,
  });

  return {
    checkout_session_id: normalizeRequired(response.session_id, "Dodo checkout session id"),
    dodo_payment_id: normalizeOptionalText(response.payment_id),
    checkout_url: normalizeRequired(response.checkout_url, "Dodo checkout url"),
  };
}

/**
 * 解析并可选校验 Dodo webhook。
 */
export function parseDodoWebhookEvent(input: {
  /** Dodo SDK client。 */
  client: DodoPayments;
  /** 原始请求 body。 */
  raw: string;
  /** 请求头。 */
  headers: Headers;
  /** 是否执行验签。 */
  verify: boolean;
}): DodoWebhookEvent {
  const event = input.verify
    ? input.client.webhooks.unwrap(input.raw, { headers: Object.fromEntries(input.headers.entries()) })
    : input.client.webhooks.unsafeUnwrap(input.raw);
  return event && typeof event === "object" ? event as unknown as DodoWebhookEvent : {};
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
 * 规范化 Dodo 运行环境。
 */
export function normalizeDodoEnvironment(value: unknown): DodoPaymentEnvironment {
  const normalized = normalizeOptionalText(value);
  if (normalized === "live_mode" || normalized === "test_mode") return normalized;
  if (normalized === "live") return "live_mode";
  if (normalized === "test") return "test_mode";
  return "test_mode";
}
