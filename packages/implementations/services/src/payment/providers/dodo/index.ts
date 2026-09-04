/**
 * Dodo Payments payment provider 工厂。
 *
 * 关键说明（中文）
 * - Dodo 只是 PaymentService 的一个 provider
 * - 负责声明 env、生成支付方式、创建 Checkout、解析 webhook
 */

import {
  normalizeCurrency,
  normalizeOptionalText,
  paymentMethodItem,
} from "../../helpers.js";
import type { DodoPaymentProviderOptions, PaymentProvider } from "../../types.js";
import {
  createDodoCheckoutSession,
  createDodoClient,
  normalizeDodoEnvironment,
  unwrap_dodo_webhook,
} from "./client.js";
import type { DodoPaymentWebhookEvent, DodoWebhookEvent } from "./types.js";

/**
 * 创建 Dodo Payments provider。
 */
export function dodoPaymentProvider(options: DodoPaymentProviderOptions = {}): PaymentProvider {
  const label = options.label?.trim() || "Dodo Payments";
  return {
    id: "dodo",
    label,
    env: [
      { key: "DODO_PAYMENTS_API_KEY", description: "Dodo Payments API key，用于创建 Checkout Session", required: true },
      { key: "DODO_PRODUCT_ID", description: "Dodo product_id，用于创建 Checkout Session", required: true },
      { key: "DODO_WEBHOOK_KEY", description: "Dodo webhook signing key，用于校验 webhook", required: true },
      { key: "DODO_ENVIRONMENT", description: "Dodo SDK 环境：test_mode 或 live_mode；默认 test_mode", required: false },
      { key: "DODO_CURRENCY", description: "默认结算币种，例如 usd", required: false },
      { key: "DODO_API_BASE_URL", description: "可选的 Dodo API 基础地址覆写，通常只用于测试环境", required: false },
    ],
    method(ctx) {
      const enabled = Boolean(
        (options.api_key || ctx.env("DODO_PAYMENTS_API_KEY"))
        && (options.product_id || ctx.env("DODO_PRODUCT_ID"))
        && (options.webhook_key || ctx.env("DODO_WEBHOOK_KEY")),
      );
      return paymentMethodItem({
        id: "dodo",
        enabled,
        label,
        currency: normalizeCurrency(ctx.env("DODO_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
      });
    },
    async createCheckout(input) {
      const api_key = options.api_key ?? input.ctx.env("DODO_PAYMENTS_API_KEY");
      const product_id = options.product_id ?? input.ctx.env("DODO_PRODUCT_ID");
      if (!api_key) throw new Error("Dodo API key is not configured");
      if (!product_id) throw new Error("Dodo product id is not configured");
      const client = createDodoClient({
        api_key,
        webhook_key: options.webhook_key ?? input.ctx.env("DODO_WEBHOOK_KEY"),
        environment: normalizeDodoEnvironment(input.ctx.env("DODO_ENVIRONMENT") || options.environment),
        api_base_url: options.api_base_url ?? input.ctx.env("DODO_API_BASE_URL"),
      });
      const created = await createDodoCheckoutSession(client, {
        payment_id: input.payment_id,
        payment: input.payment,
        product_id,
        currency: normalizeCurrency(input.ctx.env("DODO_CURRENCY")) || normalizeCurrency(options.currency) || "usd",
        return_url: input.success_url,
        cancel_url: input.cancel_url,
      });
      return {
        provider_session_id: created.checkout_session_id,
        provider_payment_id: created.dodo_payment_id,
        checkout_url: created.checkout_url,
        metadata: { product_id },
      };
    },
    async parseWebhook(input) {
      const webhook_key = options.webhook_key ?? input.ctx.env("DODO_WEBHOOK_KEY");
      if (!webhook_key) throw new Error("Dodo webhook key is not configured");
      const client = createDodoClient({
        api_key: options.api_key ?? input.ctx.env("DODO_PAYMENTS_API_KEY") ?? "webhook_only",
        webhook_key,
        environment: normalizeDodoEnvironment(input.ctx.env("DODO_ENVIRONMENT") || options.environment),
        api_base_url: options.api_base_url ?? input.ctx.env("DODO_API_BASE_URL"),
      });
      const verified_webhook = unwrap_dodo_webhook({
        client,
        raw: input.raw,
        headers: input.request.headers,
      });
      const event = verified_webhook.event;
      const payment_event = is_dodo_payment_event(event) ? event : undefined;
      const type = event.type;
      const provider_payment_id = normalizeOptionalText(payment_event?.data.payment_id);
      const checkout_session_id = normalizeOptionalText(payment_event?.data.checkout_session_id);
      return {
        event_id: verified_webhook.webhook_id,
        type,
        payload: event as unknown as Record<string, unknown>,
        status: type === "payment.succeeded"
          ? "paid"
          : type === "payment.failed"
            ? "failed"
            : type === "payment.cancelled"
              ? "canceled"
              : "ignored",
        payment_id: normalizeOptionalText(payment_event?.data.metadata.payment_id),
        provider_session_id: checkout_session_id,
        provider_payment_id,
        ref: provider_payment_id || checkout_session_id,
        meta: {
          provider: "dodo",
          dodo_webhook_id: verified_webhook.webhook_id,
          dodo_checkout_session_id: checkout_session_id,
          dodo_payment_id: provider_payment_id,
        },
      };
    },
  };
}

/** 判断官方 SDK 事件是否属于 PaymentService 负责的支付生命周期。 */
function is_dodo_payment_event(event: DodoWebhookEvent): event is DodoPaymentWebhookEvent {
  return event.type === "payment.processing"
    || event.type === "payment.succeeded"
    || event.type === "payment.failed"
    || event.type === "payment.cancelled";
}
