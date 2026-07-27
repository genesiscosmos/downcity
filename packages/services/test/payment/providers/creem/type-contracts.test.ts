/**
 * Creem payment provider 类型契约测试。
 *
 * 关键说明（中文）
 * - 这个文件只做编译期契约验证
 * - 覆盖统一 PaymentService、provider 和主要返回类型
 */

import { Federation } from "@downcity/city";
import {
  creemPaymentProvider,
  PaymentService,
  type PaymentCheckoutCreateResult,
} from "../../../../src/index.js";

const base = new Federation({ db: {} as any });

base.use(new PaymentService({
  resolve_topup: ({ topup_amount_minor }) => ({ credits: topup_amount_minor * 10_000 }),
  on_paid: async (_record) => undefined,
  providers: [
    creemPaymentProvider({
      api_key: "creem_test",
      product_id: "prod_test",
      webhook_secret: "webhook_test",
      currency: "usd",
    }),
  ],
}));

const checkout: PaymentCheckoutCreateResult = {
  payment_id: "pay_demo",
  provider: "creem",
  provider_session_id: "ch_demo",
  provider_payment_id: "",
  provider_order_id: "",
  checkout_url: "https://checkout.creem.test/ch_demo",
  status: "pending",
  credits: 5_000_000,
  topup_amount_minor: 500,
  currency: "usd",
};

void checkout;
