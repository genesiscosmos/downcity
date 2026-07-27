/**
 * Payment 子模块公共入口。
 *
 * 关键说明（中文）
 * - PaymentService 实现位于 service.ts
 * - 路由注册逻辑位于 routes.ts
 * - 各 provider 工厂位于 providers/ 目录下
 */

export { PaymentService } from "./service.js";
export type {
  PaymentOrderSnapshot,
  PaymentServiceOptions,
  PaymentTopupResolution,
  PaymentTopupResolutionInput,
} from "./types.js";
export { paymentEvents, paymentPayments } from "./schema.js";
export {
  creemPaymentProvider,
  dodoPaymentProvider,
  stripePaymentProvider,
  waffoPaymentProvider,
} from "./providers/index.js";
