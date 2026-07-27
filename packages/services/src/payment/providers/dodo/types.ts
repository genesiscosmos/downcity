/**
 * Dodo provider 内部类型。
 *
 * 关键说明（中文）
 * - 仅供 dodo provider 内部使用
 * - 对外可见类型（如 DodoPaymentProviderOptions）放在 payment/types.ts
 */

import type { PaymentOrderSnapshot } from "../../types.js";

/**
 * Dodo SDK 运行环境。
 */
export type DodoPaymentEnvironment = "test_mode" | "live_mode";

/**
 * Dodo Checkout API 创建参数。
 */
export interface DodoCreateCheckoutSessionInput {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** 支付订单快照。 */
  payment: PaymentOrderSnapshot;
  /** Dodo product_id。 */
  product_id: string;
  /** 结算币种。 */
  currency: string;
  /** 支付完成跳转地址。 */
  return_url: string;
  /** 支付取消跳转地址。 */
  cancel_url: string;
}

/**
 * Dodo Checkout API 创建结果。
 */
export interface DodoCheckoutSessionResult {
  /** Dodo Checkout Session ID。 */
  checkout_session_id: string;
  /** Dodo Payment ID。 */
  dodo_payment_id: string;
  /** Dodo Checkout 托管页面 URL。 */
  checkout_url: string;
}

/**
 * Dodo webhook 事件。
 */
export interface DodoWebhookEvent extends Record<string, unknown> {
  /** Dodo 事件 ID。 */
  id?: unknown;
  /** Dodo 事件 ID 备用字段。 */
  event_id?: unknown;
  /** Dodo 事件类型。 */
  type?: unknown;
  /** Dodo 事件类型备用字段。 */
  eventType?: unknown;
  /** Dodo 事件数据。 */
  data?: unknown;
  /** Dodo 事件主体备用字段。 */
  object?: unknown;
}
