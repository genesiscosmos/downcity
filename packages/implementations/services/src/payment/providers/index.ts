/**
 * Payment provider 工厂统一入口。
 *
 * 关键说明（中文）
 * - Stripe / Creem / Dodo / Waffo 都只是 PaymentService 的 provider
 * - 每个 provider 单独放在自己的子目录里，便于扩展和维护
 */

export { creemPaymentProvider } from "./creem/index.js";
export { dodoPaymentProvider } from "./dodo/index.js";
export { stripePaymentProvider } from "./stripe/index.js";
export { waffoPaymentProvider } from "./waffo/index.js";
