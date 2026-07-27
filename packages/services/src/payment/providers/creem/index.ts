/**
 * Creem payment provider 工厂。
 *
 * 关键说明（中文）
 * - Creem 只是 PaymentService 的一个 provider
 * - 负责声明 env、生成支付方式、创建 Checkout、解析 webhook
 */

import {
  normalizeCurrency,
  normalizeOptionalText,
  normalizeRequired,
  paymentMethodItem,
  readObjectId,
} from "../../helpers.js";
import type { CreemPaymentProviderOptions, PaymentProvider } from "../../types.js";
import {
  createCreemCheckoutSession,
  normalizeCreemApiBaseURL,
  parseCreemWebhookEvent,
  readCreemEventObject,
  readMetadata,
  verifyCreemSignature,
} from "./client.js";

/**
 * 创建 Creem payment provider。
 */
export function creemPaymentProvider(options: CreemPaymentProviderOptions = {}): PaymentProvider {
  const label = options.label?.trim() || "Creem";
  return {
    id: "creem",
    label,
    env: [
      { key: "CREEM_API_KEY", description: "Creem API key，用于创建 Checkout Session", required: true },
      { key: "CREEM_PRODUCT_ID", description: "Creem 一次性、含税支付 product_id，用于创建动态价格 Checkout Session", required: true },
      { key: "CREEM_WEBHOOK_SECRET", description: "Creem webhook signing secret，用于校验 creem-signature", required: true },
      { key: "CREEM_CURRENCY", description: "Creem 产品币种，例如 usd；必须与 product_id 的实际币种一致", required: false },
      { key: "CREEM_API_BASE_URL", description: "可选的 Creem API 基础地址覆写，通常只用于测试环境", required: false },
    ],
    method(ctx) {
      const enabled = Boolean(
        (options.api_key || ctx.env("CREEM_API_KEY"))
        && (options.product_id || ctx.env("CREEM_PRODUCT_ID"))
        && (options.webhook_secret || ctx.env("CREEM_WEBHOOK_SECRET")),
      );
      return paymentMethodItem({
        id: "creem",
        enabled,
        label,
        currency: normalizeCurrency(ctx.env("CREEM_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
      });
    },
    async createCheckout(input) {
      const api_key = options.api_key ?? input.ctx.env("CREEM_API_KEY");
      const product_id = options.product_id ?? input.ctx.env("CREEM_PRODUCT_ID");
      if (!api_key) throw new Error("Creem API key is not configured");
      if (!product_id) throw new Error("Creem product id is not configured");
      if (input.payment.amount_minor < 100 || input.payment.amount_minor > 99_999_999) {
        throw new RangeError("Creem custom price must be between 100 and 99999999 minor units");
      }
      const created = await createCreemCheckoutSession(
        api_key,
        normalizeCreemApiBaseURL(input.ctx.env("CREEM_API_BASE_URL") || options.api_base_url),
        {
          payment_id: input.payment_id,
          payment: input.payment,
          product_id,
          success_url: input.success_url,
        },
      );
      return {
        provider_session_id: created.checkout_id,
        checkout_url: created.checkout_url,
        metadata: { product_id, custom_price: input.payment.amount_minor },
      };
    },
    async parseWebhook(input) {
      const webhook_secret = options.webhook_secret ?? input.ctx.env("CREEM_WEBHOOK_SECRET");
      if (!webhook_secret) throw new Error("Creem webhook secret is not configured");
      const valid = await verifyCreemSignature(
        input.raw,
        input.request.headers.get("creem-signature"),
        webhook_secret,
      );
      if (!valid) throw new Error("Invalid Creem signature");
      const event = parseCreemWebhookEvent(input.raw);
      const object = readCreemEventObject(event);
      const metadata = readMetadata(object.metadata);
      const type = normalizeOptionalText(event.eventType) || normalizeOptionalText(event.type) || "unknown";
      const order = readMetadata(object.order);
      const order_id = readObjectId(order) || normalizeOptionalText(object.order_id);
      const checkout_id = readObjectId(object) || normalizeOptionalText(object.checkout_id);
      return {
        event_id: normalizeRequired(event.id, "creem event id"),
        type,
        payload: event,
        status: type === "checkout.completed"
          ? "paid"
          : type === "checkout.expired"
            ? "expired"
            : type === "checkout.failed" || type === "payment.failed"
              ? "failed"
              : "ignored",
        payment_id: normalizeOptionalText(metadata.payment_id) || normalizeOptionalText(object.request_id),
        provider_session_id: checkout_id,
        provider_order_id: order_id,
        ref: order_id || checkout_id,
        meta: {
          provider: "creem",
          creem_event_id: normalizeOptionalText(event.id),
          creem_checkout_id: checkout_id,
          creem_order_id: order_id,
        },
      };
    },
  };
}
