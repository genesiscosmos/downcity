/**
 * Waffo provider 内部类型。
 *
 * 关键说明（中文）
 * - 仅供 waffo provider 内部使用
 * - 对外可见类型（如 WaffoPaymentProviderOptions）放在 payment/types.ts
 */

import type { PaymentOrderSnapshot } from "../../types.js";

/**
 * Waffo 运行环境。
 */
export type WaffoPaymentEnvironment = "test" | "prod";

/**
 * Waffo Checkout API 创建参数。
 */
export interface WaffoCreateCheckoutSessionInput {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** 支付订单快照。 */
  payment: PaymentOrderSnapshot;
  /** Waffo product_id。 */
  product_id: string;
  /** 结算币种。 */
  currency: string;
  /** 支付成功跳转地址。 */
  success_url: string;
}

/**
 * Waffo Checkout API 创建结果。
 */
export interface WaffoCheckoutSessionResult {
  /** Waffo Checkout Session ID。 */
  session_id: string;
  /** Waffo Checkout 托管页面 URL。 */
  checkout_url: string;
}

/**
 * Waffo webhook 事件数据部分。
 */
export interface WaffoWebhookEventData extends Record<string, unknown> {
  /** Waffo 订单 ID。 */
  orderId?: unknown;
  /** Waffo 支付 ID。 */
  paymentId?: unknown;
  /** 商户提交的订单外部 ID（即 payment_id）。 */
  orderMerchantExternalId?: unknown;
  /** 订单 metadata，用于回带 payment_id 等业务字段。 */
  orderMetadata?: unknown;
}

/**
 * Waffo webhook 事件。
 */
export interface WaffoWebhookEvent extends Record<string, unknown> {
  /** Waffo 事件 ID。 */
  id?: unknown;
  /** Waffo 事件 ID 备用字段。 */
  eventId?: unknown;
  /** Waffo 事件类型。 */
  eventType?: unknown;
  /** Waffo 事件数据。 */
  data?: WaffoWebhookEventData;
}
