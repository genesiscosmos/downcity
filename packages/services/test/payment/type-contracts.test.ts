/**
 * Payment 服务类型契约测试。
 */

import { Federation } from "@downcity/city";
import { PaymentService, stripePaymentProvider } from "../../src/index.js";

const base = new Federation({
  db: {} as never,
});

base.use(new PaymentService({
  resolve_topup: ({ topup_amount_minor }) => ({ credits: topup_amount_minor * 10_000 }),
  on_paid: async (_record) => undefined,
  providers: [
    stripePaymentProvider(),
  ],
}));
