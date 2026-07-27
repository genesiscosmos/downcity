/**
 * Stripe payment provider 工厂。
 *
 * 关键说明（中文）
 * - Stripe 只是 PaymentService 的一个 provider
 * - 负责声明 env、生成支付方式、创建 Checkout、解析 webhook
 */

import {
  normalizeCurrency,
  normalizeOptionalText,
  normalizeRequired,
  paymentMethodItem,
} from "../../helpers.js";
import type { PaymentProvider, StripePaymentProviderOptions } from "../../types.js";
import {
  createStripeCheckoutSession,
  normalizeStripeApiBaseURL,
  parseStripeWebhookEvent,
  readMetadata,
  verifyStripeSignature,
} from "./client.js";

/**
 * 创建 Stripe payment provider。
 */
export function stripePaymentProvider(options: StripePaymentProviderOptions = {}): PaymentProvider {
  const label = options.label?.trim() || "Stripe";
  return {
    id: "stripe",
    label,
    env: [
      { key: "STRIPE_SECRET_KEY", description: "Stripe secret key，用于创建 Checkout Session", required: true },
      { key: "STRIPE_WEBHOOK_SECRET", description: "Stripe webhook signing secret，用于校验 stripe-signature", required: true },
      { key: "STRIPE_CURRENCY", description: "默认结算币种，例如 usd", required: false },
      { key: "STRIPE_ITEM_NAME", description: "Stripe Checkout 展示的默认商品名", required: false },
      { key: "STRIPE_API_BASE_URL", description: "可选的 Stripe API 基础地址覆写，通常只用于测试环境", required: false },
    ],
    method(ctx) {
      const enabled = Boolean(
        (options.secret_key || ctx.env("STRIPE_SECRET_KEY"))
        && (options.webhook_secret || ctx.env("STRIPE_WEBHOOK_SECRET")),
      );
      return paymentMethodItem({
        id: "stripe",
        enabled,
        label,
        currency: normalizeCurrency(ctx.env("STRIPE_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
      });
    },
    async createCheckout(input) {
      const secret_key = options.secret_key ?? input.ctx.env("STRIPE_SECRET_KEY");
      if (!secret_key) throw new Error("Stripe secret key is not configured");
      const created = await createStripeCheckoutSession(
        secret_key,
        normalizeStripeApiBaseURL(input.ctx.env("STRIPE_API_BASE_URL") || options.api_base_url),
        {
          payment_id: input.payment_id,
          payment: input.payment,
          currency: normalizeCurrency(input.ctx.env("STRIPE_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
          success_url: input.success_url,
          cancel_url: input.cancel_url,
          item_name: normalizeOptionalText(input.ctx.env("STRIPE_ITEM_NAME"))
            || normalizeOptionalText(options.item_name)
            || "Downcity Topup",
        },
      );
      return {
        provider_session_id: created.session_id,
        provider_payment_id: created.payment_intent_id,
        checkout_url: created.checkout_url,
      };
    },
    async parseWebhook(input) {
      const webhook_secret = options.webhook_secret ?? input.ctx.env("STRIPE_WEBHOOK_SECRET");
      if (!webhook_secret) throw new Error("Stripe webhook secret is not configured");
      const valid = await verifyStripeSignature(
        input.raw,
        input.request.headers.get("stripe-signature"),
        webhook_secret,
      );
      if (!valid) throw new Error("Invalid Stripe signature");
      const event = parseStripeWebhookEvent(input.raw);
      const object = readMetadata(event.data?.object);
      const metadata = readMetadata(object.metadata);
      const type = normalizeOptionalText(event.type) || "unknown";
      const status = type === "checkout.session.completed"
        ? normalizeOptionalText(object.payment_status) === "paid" ? "paid" : "pending"
        : type === "checkout.session.async_payment_succeeded"
          ? "paid"
          : type === "checkout.session.async_payment_failed"
            ? "failed"
            : type === "checkout.session.expired"
              ? "expired"
              : type === "payment_intent.payment_failed"
                ? "failed"
                : "ignored";
      const is_payment_intent = type === "payment_intent.payment_failed";
      return {
        event_id: normalizeRequired(event.id, "stripe event id"),
        type,
        payload: event,
        status,
        payment_id: normalizeOptionalText(metadata.payment_id),
        provider_session_id: is_payment_intent ? undefined : normalizeOptionalText(object.id),
        provider_payment_id: is_payment_intent
          ? normalizeOptionalText(object.id)
          : normalizeOptionalText(object.payment_intent),
        ref: normalizeOptionalText(object.id),
        meta: {
          provider: "stripe",
          stripe_event_id: normalizeOptionalText(event.id),
          stripe_checkout_session_id: is_payment_intent ? undefined : normalizeOptionalText(object.id),
          stripe_payment_intent_id: is_payment_intent
            ? normalizeOptionalText(object.id)
            : normalizeOptionalText(object.payment_intent),
        },
      };
    },
  };
}
