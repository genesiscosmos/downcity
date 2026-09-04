/**
 * Waffo Pancake SDK 工具函数。
 *
 * 关键说明（中文）
 * - 创建 Checkout 使用官方 `@waffo/pancake-ts` SDK
 * - webhook 验签使用 SDK 自带 RSA-SHA256 verify
 */

import { TaxCategory, WaffoPancake } from "@waffo/pancake-ts";
import { normalizeOptionalText, normalizeRequired } from "../../helpers.js";
import type {
  WaffoCheckoutSessionResult,
  WaffoCreateCheckoutSessionInput,
  WaffoPaymentEnvironment,
  WaffoWebhookEvent,
} from "./types.js";

/**
 * 创建 Waffo SDK client。
 */
export function createWaffoClient(input: {
  /** Waffo Merchant ID。 */
  merchant_id: string;
  /** Waffo private key。 */
  private_key: string;
  /** 可选 webhook public key。 */
  webhook_public_key?: string;
  /** 可选 API 基础地址。 */
  api_base_url?: string;
}): WaffoPancake {
  return new WaffoPancake({
    merchantId: normalizeRequired(input.merchant_id, "Waffo merchant id"),
    privateKey: normalizeRequired(input.private_key, "Waffo private key"),
    webhookPublicKey: normalizeOptionalText(input.webhook_public_key) || undefined,
    baseUrl: normalizeOptionalText(input.api_base_url) || undefined,
  });
}

/**
 * 创建 Waffo Checkout Session。
 */
export async function createWaffoCheckoutSession(
  client: WaffoPancake,
  input: WaffoCreateCheckoutSessionInput,
): Promise<WaffoCheckoutSessionResult> {
  const response = await client.checkout.createSession({
    productId: input.product_id,
    currency: input.currency.toUpperCase(),
    priceSnapshot: {
      amount: format_minor_amount(input.payment.amount_minor, input.currency),
      taxCategory: TaxCategory.DigitalGoods,
    },
    successUrl: input.success_url,
    orderMerchantExternalId: input.payment_id,
    metadata: {
      payment_id: input.payment_id,
      user_id: input.payment.user_id,
      credits: String(input.payment.credits),
      amount_minor: String(input.payment.amount_minor),
    },
  });

  return {
    session_id: normalizeRequired(response.sessionId, "Waffo checkout session id"),
    checkout_url: normalizeRequired(response.checkoutUrl, "Waffo checkout url"),
  };
}

/** 把最小货币单位金额转换为 Waffo 需要的展示金额字符串。 */
function format_minor_amount(amount_minor: number, currency: string): string {
  const fraction_digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10 ** fraction_digits;
  return (amount_minor / divisor).toFixed(fraction_digits);
}

/**
 * 解析并校验 Waffo webhook。
 */
export function parseWaffoWebhookEvent(input: {
  /** Waffo SDK client。 */
  client: WaffoPancake;
  /** 原始请求 body。 */
  raw: string;
  /** 签名请求头。 */
  signature: string | null;
  /** 事件环境。 */
  environment: WaffoPaymentEnvironment;
}): WaffoWebhookEvent {
  const event = input.client.webhooks.verify(input.raw, input.signature, {
    environment: input.environment,
  });
  return event && typeof event === "object" ? event as unknown as WaffoWebhookEvent : {};
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
 * 规范化 Waffo 运行环境。
 */
export function normalizeWaffoEnvironment(value: unknown): WaffoPaymentEnvironment {
  const normalized = normalizeOptionalText(value).toLowerCase();
  if (normalized === "prod" || normalized === "production" || normalized === "live") return "prod";
  return "test";
}

/**
 * Waffo webhook-only fallback 私钥。
 *
 * 关键说明（中文）
 * - 仅用于 webhook-only 场景，让 SDK 能完成签名验证流程
 * - 不会用于任何真实请求，真实请求必须配置 WAFFO_PRIVATE_KEY
 */
export function fallbackWaffoPrivateKey(): string {
  return [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEpAIBAAKCAQEAtAqPA17F1sr9kylJy8LbcaHrim/UocR/ur3z5Vu7QQTUhuPO",
    "pbsYnu1oFGwCsCjFhBBapI8/Huy9ARP3/Oxsp4kna9gEPLRSTMfUK5a0nPUnkHXv",
    "DFgzIFYn1Yac/3FiA4zIA5BH+0ZUBu8cFZ1MvaPu7YFQvr165hOmwLnoJsypcY5V",
    "Kjb8p+HjMXyiCy3gUId2DCJuUhjbtUo84gI3v4YAI6YD07pNUSm5wFDFKsYeymdV",
    "QdtBhgPUx0RJDyhOKU1Vq8mge2b03ZiQK3O3gUmQgP0sAUpyyUrHaMjs/nAw9dqy",
    "Wl0VyglAIcl79sRVUXTHgEHGf+j0pNcyVjIF2QIDAQABAoIBAAM1bPcSaVQ6qepF",
    "ghsvjdmomRoOhCud5OjfGcmsqNmvzFnbFYO+oeGzOXejtSiOkXaZFAR6yRU0AupS",
    "AMlxLT6PIzS41NqAHDdiGFXuiamCdQIOGASQTdj1sCAOFh43VxfZGnd1ytKfnj/B",
    "Yy6/bu6yTT/OXjIIDnirQP2OUqTeWTHdf1xgQGkb+y20Oo3JgJ637j67HuLPrpzs",
    "jIluqhRszKwVWhGlyTYJdK8nOv2sn+Kn8cEFybmbcytWk9Sxf128+IjTgsEFgEcy",
    "RS6/UofjKfh9WY+4DK/L7mQgdYwawiRX4y4MkExCusmQxT72mDVGXnSbTYNp2qZl",
    "WEgFeQECgYEA8cgKGrySiDFxJb900I5O/CL+1pIYXy6K4gDLk70luwjRSWU+ufZo",
    "g/IRntgk0b0eC4vzP6539hQsh8rrO2swv0vBDG/cvyjP7ljHTx0pFtAjb/yJ9PXN",
    "ca08G8qx6BX5mqdD46T56V4g5PtLT6cwn5Hth2/H+4MZ/5osP3CbU0UCgYEAvqEJ",
    "OEOlKMRhxdfb7RnKMwiXUN2vZ0NuGgK0slqEC9FAv1E/XV8azcs40uINrDdieRmr",
    "Oi+LBXC08FHiAKZOVuxg1DzKx8gDc/R6YGT5sKVhVhKgWsF9ysmCyyqdqnuvFMAd",
    "7PgS4Nf01rO9jo+cqKBHTzFny0TWZTTAR6NzZ4UCgYEAzqcKs+V/XPbdXcUxg9xO",
    "eEU1CZLfT+NJA3hoiAMAD8eukgv+PBX3KOeq1diqR7ZbysS4iTKHCAYgNYRj4Gpy",
    "xN5rx0SJKb4pUvAAkoc7CmumDl6MT5oUGdhWau6pdtPpfpz+csEcdbFlbjG3IgKl",
    "lY21tq/8/uUEQKq2rRaDO/0CgYAUgC0FqACzCauaI0S7kvJz2pCrWavrZw0ILxJP",
    "u/xHaRGVgZ9W40t2pkxOIZFm2+3zKBeKAmLpCt3qmmO7vibeoj0nlgIYyiHU7o3a",
    "oAFaRe7Z2tbz66sji9hNESAznWmOybpuKZ+eHptuG5ZfJoKqf9IrahzHd3e3Gp0z",
    "FxjqIQKBgQDbHuXgZL8A7pQe+YFUVbXYjhzb+sTlVQD7C4KF0sdiKNKXcXhvcCxL",
    "AfJu59vnIlhD4MUcxt5lWDBLX08dmcJOX2AryDMmNVC7knNu92IehJeboSaM1+t3",
    "1V/8pTMTtzg5ANHzZICj6vn46UXCL78XUC3sqZdAm/+9kS+oAnWaIw==",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
}
