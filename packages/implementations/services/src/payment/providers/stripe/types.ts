/**
 * Stripe provider 内部类型。
 *
 * 关键说明（中文）
 * - 仅供 stripe provider 内部使用
 * - 对外可见类型（如 StripePaymentProviderOptions）放在 payment/types.ts
 */

import type { PaymentOrderSnapshot } from "../../types.js";

/**
 * Stripe Checkout API 创建参数。
 */
export interface StripeCreateCheckoutSessionInput {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** 支付订单快照。 */
  payment: PaymentOrderSnapshot;
  /** 结算币种。 */
  currency: string;
  /** 支付成功跳转地址。 */
  success_url: string;
  /** 支付取消跳转地址。 */
  cancel_url: string;
  /** Stripe Checkout 展示的商品名称。 */
  item_name: string;
}

/**
 * Stripe Checkout API 创建结果。
 */
export interface StripeCheckoutSessionResult {
  /** Stripe Checkout Session ID。 */
  session_id: string;
  /** Stripe Checkout 托管页面 URL。 */
  checkout_url: string;
  /** 关联的 Payment Intent ID（创建时可能为空）。 */
  payment_intent_id: string;
}

/**
 * Stripe webhook 事件。
 */
export interface StripeWebhookEvent extends Record<string, unknown> {
  /** Stripe 事件 ID。 */
  id?: unknown;
  /** Stripe 事件类型。 */
  type?: unknown;
  /** Stripe 事件 data。 */
  data?: {
    /** 事件主体对象。 */
    object?: unknown;
  };
}
