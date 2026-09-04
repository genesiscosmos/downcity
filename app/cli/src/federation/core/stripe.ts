/**
 * Stripe 终端辅助模块。
 *
 * 关键说明（中文）
 * - manager 侧不直接管理 Stripe 资源
 * - 这里只负责基于当前 City server 推导可复制的固定回调地址
 * - 这样用户在 Stripe Dashboard 里不需要手动拼 webhook URL
 */

import { normalizeBaseUrl } from "@/federation/core/env.js";

/**
 * Stripe 常用 endpoint 集合。
 */
export interface StripeEndpointSet {
  /** 当前 City 对外地址 */
  base_url: string;
  /** Stripe webhook endpoint */
  webhook_url: string;
  /** 默认支付成功页 */
  success_url: string;
  /** 默认支付取消页 */
  cancel_url: string;
}

/**
 * 基于当前 City 地址构建 Stripe 相关 URL。
 */
export function buildStripeEndpoints(baseUrl: string): StripeEndpointSet {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return {
    base_url: normalizedBaseUrl,
    webhook_url: `${normalizedBaseUrl}/v1/payment.stripe/webhook`,
    success_url: `${normalizedBaseUrl}/v1/payment.stripe/redirect/success`,
    cancel_url: `${normalizedBaseUrl}/v1/payment.stripe/redirect/cancel`,
  };
}
