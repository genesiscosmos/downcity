/**
 * Payment 服务类型契约测试。
 */

import { Downtown } from "@downcity/downtown";
import { PaymentService, stripePaymentProvider } from "../../src/index.js";

const base = new Downtown({
  database: {} as never,
});

base.use(new PaymentService({
  resolve_topup: ({ topup_amount_minor }) => ({ credits: topup_amount_minor * 10_000 }),
  on_paid: async (_record) => undefined,
  providers: [
    stripePaymentProvider(),
  ],
}));
