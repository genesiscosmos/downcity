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
  DodoVerifiedWebhook,
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
 * 使用 Dodo 官方 SDK 验签并解析 webhook 信封。
 *
 * 关键说明（中文）
 * - Dodo 遵循 Standard Webhooks，三个协议 Header 都是必需字段。
 * - `webhook-id` 是事件唯一身份；官方 SDK 的 unwrap 返回值只包含 body。
 * - 必须使用未经改写的原始 body 完成签名校验。
 */
export function unwrap_dodo_webhook(input: {
  /** Dodo SDK client。 */
  client: DodoPayments;
  /** 原始请求 body。 */
  raw: string;
  /** 请求头。 */
  headers: Headers;
}): DodoVerifiedWebhook {
  const webhook_id = normalizeRequired(input.headers.get("webhook-id"), "Dodo webhook-id header");
  const webhook_timestamp = normalizeRequired(
    input.headers.get("webhook-timestamp"),
    "Dodo webhook-timestamp header",
  );
  const webhook_signature = normalizeRequired(
    input.headers.get("webhook-signature"),
    "Dodo webhook-signature header",
  );
  const event = input.client.webhooks.unwrap(input.raw, {
    headers: {
      "webhook-id": webhook_id,
      "webhook-timestamp": webhook_timestamp,
      "webhook-signature": webhook_signature,
    },
  });
  return { webhook_id, event };
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
