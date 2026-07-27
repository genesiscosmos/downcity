/**
 * Waffo Pancake payment provider 工厂。
 *
 * 关键说明（中文）
 * - Waffo 只是 PaymentService 的一个 provider
 * - 负责声明 env、生成支付方式、创建 Checkout、解析 webhook
 */

import {
  normalizeCurrency,
  normalizeOptionalText,
  normalizeRequired,
  paymentMethodItem,
  randomId,
} from "../../helpers.js";
import type { PaymentProvider, WaffoPaymentProviderOptions } from "../../types.js";
import {
  createWaffoCheckoutSession,
  createWaffoClient,
  fallbackWaffoPrivateKey,
  normalizeWaffoEnvironment,
  parseWaffoWebhookEvent,
  readMetadata,
} from "./client.js";

/**
 * 创建 Waffo Pancake provider。
 */
export function waffoPaymentProvider(options: WaffoPaymentProviderOptions = {}): PaymentProvider {
  const label = options.label?.trim() || "Waffo Pancake";
  return {
    id: "waffo",
    label,
    env: [
      { key: "WAFFO_MERCHANT_ID", description: "Waffo Merchant ID，例如 MER_xxx", required: true },
      { key: "WAFFO_PRIVATE_KEY", description: "Waffo API private key，用于 SDK 请求签名", required: true },
      { key: "WAFFO_PRODUCT_ID", description: "Waffo product_id，用于创建 Checkout Session", required: true },
      { key: "WAFFO_WEBHOOK_PUBLIC_KEY", description: "Waffo webhook public key，用于校验 x-waffo-signature", required: false },
      { key: "WAFFO_ENVIRONMENT", description: "Waffo 环境：test 或 prod；默认 test", required: false },
      { key: "WAFFO_CURRENCY", description: "默认结算币种，例如 usd", required: false },
      { key: "WAFFO_API_BASE_URL", description: "可选的 Waffo API 基础地址覆写，通常只用于测试环境", required: false },
    ],
    method(ctx) {
      const enabled = Boolean(
        (options.merchant_id || ctx.env("WAFFO_MERCHANT_ID"))
        && (options.private_key || ctx.env("WAFFO_PRIVATE_KEY"))
        && (options.product_id || ctx.env("WAFFO_PRODUCT_ID")),
      );
      return paymentMethodItem({
        id: "waffo",
        enabled,
        label,
        currency: normalizeCurrency(ctx.env("WAFFO_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
      });
    },
    async createCheckout(input) {
      const merchant_id = options.merchant_id ?? input.ctx.env("WAFFO_MERCHANT_ID");
      const private_key = options.private_key ?? input.ctx.env("WAFFO_PRIVATE_KEY");
      const product_id = options.product_id ?? input.ctx.env("WAFFO_PRODUCT_ID");
      if (!merchant_id) throw new Error("Waffo merchant id is not configured");
      if (!private_key) throw new Error("Waffo private key is not configured");
      if (!product_id) throw new Error("Waffo product id is not configured");
      const client = createWaffoClient({
        merchant_id,
        private_key,
        webhook_public_key: options.webhook_public_key ?? input.ctx.env("WAFFO_WEBHOOK_PUBLIC_KEY"),
        api_base_url: options.api_base_url ?? input.ctx.env("WAFFO_API_BASE_URL"),
      });
      const created = await createWaffoCheckoutSession(client, {
        payment_id: input.payment_id,
        payment: input.payment,
        product_id,
        currency: normalizeCurrency(input.ctx.env("WAFFO_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
        success_url: input.success_url,
      });
      return {
        provider_session_id: created.session_id,
        checkout_url: created.checkout_url,
        metadata: { product_id },
      };
    },
    async parseWebhook(input) {
      const client = createWaffoClient({
        merchant_id: options.merchant_id ?? input.ctx.env("WAFFO_MERCHANT_ID") ?? "MER_0000000000000000000000",
        private_key: options.private_key ?? input.ctx.env("WAFFO_PRIVATE_KEY") ?? fallbackWaffoPrivateKey(),
        webhook_public_key: options.webhook_public_key ?? input.ctx.env("WAFFO_WEBHOOK_PUBLIC_KEY"),
        api_base_url: options.api_base_url ?? input.ctx.env("WAFFO_API_BASE_URL"),
      });
      const event = parseWaffoWebhookEvent({
        client,
        raw: input.raw,
        signature: input.request.headers.get("x-waffo-signature"),
        environment: normalizeWaffoEnvironment(input.ctx.env("WAFFO_ENVIRONMENT") || options.environment),
      });
      const data = readMetadata(event.data);
      const metadata = readMetadata(data.orderMetadata);
      const order_id = normalizeOptionalText(data.orderId);
      const payment_id = normalizeOptionalText(data.paymentId) || normalizeOptionalText(event.eventId);
      const type = normalizeOptionalText(event.eventType) || "unknown";
      return {
        event_id: normalizeRequired(event.id || event.eventId || `evt_${randomId()}`, "waffo event id"),
        type,
        payload: event,
        status: type === "order.completed" ? "paid" : "ignored",
        payment_id: normalizeOptionalText(data.orderMerchantExternalId),
        provider_payment_id: payment_id,
        provider_order_id: order_id,
        ref: payment_id || order_id,
        meta: {
          provider: "waffo",
          waffo_event_id: normalizeOptionalText(event.id || event.eventId),
          waffo_order_id: order_id,
          waffo_payment_id: payment_id,
        },
      };
    },
  };
}
