/**
 * Creem provider 内部类型。
 *
 * 关键说明（中文）
 * - 仅供 creem provider 内部使用
 * - 对外可见类型（如 CreemPaymentProviderOptions）放在 payment/types.ts
 */

import type { PaymentOrderSnapshot } from "../../types.js";

/**
 * Creem Checkout API 创建参数。
 */
export interface CreemCreateCheckoutSessionInput {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** 支付订单快照。 */
  payment: PaymentOrderSnapshot;
  /** Creem product_id。 */
  product_id: string;
  /** 支付成功跳转地址。 */
  success_url: string;
}

/**
 * Creem Checkout API 创建结果。
 */
export interface CreemCheckoutSessionResult {
  /** Creem Checkout ID。 */
  checkout_id: string;
  /** Creem Checkout 托管页面 URL。 */
  checkout_url: string;
}

/**
 * Creem webhook 事件。
 */
export interface CreemWebhookEvent extends Record<string, unknown> {
  /** Creem 事件 ID。 */
  id?: unknown;
  /** Creem 事件类型（官方字段）。 */
  eventType?: unknown;
  /** 兼容代理转发后的事件类型字段。 */
  type?: unknown;
  /** Creem 事件主体对象。 */
  object?: unknown;
  /** 兼容 data.object 形式。 */
  data?: {
    /** 事件主体对象。 */
    object?: unknown;
  };
}
