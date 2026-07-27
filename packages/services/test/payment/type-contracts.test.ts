/**
 * Payment 服务类型契约测试。
 */

import { Federation } from "@downcity/city";
import { PaymentService, stripePaymentProvider } from "../../src/index.js";

const base = new Federation({
  db: {} as never,
});

base.use(new PaymentService({
  on_paid: async (_record) => undefined,
  providers: [
    stripePaymentProvider(),
  ],
}));
