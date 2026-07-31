/**
 * Dodo provider 内部类型。
 *
 * 关键说明（中文）
 * - 仅供 dodo provider 内部使用
 * - 对外可见类型（如 DodoPaymentProviderOptions）放在 payment/types.ts
 */

import type { UnwrapWebhookEvent } from "dodopayments/resources/webhooks";
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

/** Dodo 官方 SDK 验签后返回的 webhook 事件联合类型。 */
export type DodoWebhookEvent = UnwrapWebhookEvent;

/** Dodo 支付生命周期 webhook 事件。 */
export type DodoPaymentWebhookEvent = Extract<
  DodoWebhookEvent,
  {
    type:
      | "payment.processing"
      | "payment.succeeded"
      | "payment.failed"
      | "payment.cancelled";
  }
>;

/**
 * 已通过 Dodo 官方 SDK 验签的 webhook 信封。
 *
 * Dodo 遵循 Standard Webhooks：事件身份属于 `webhook-id` 请求头，
 * 不属于 webhook body，也不等同于 payment ID。
 */
export interface DodoVerifiedWebhook {
  /** Dodo 为本次逻辑事件分配的唯一 `webhook-id`，用于幂等处理。 */
  webhook_id: string;
  /** Dodo 官方 SDK 从原始 body 解析得到的强类型事件。 */
  event: DodoWebhookEvent;
}
