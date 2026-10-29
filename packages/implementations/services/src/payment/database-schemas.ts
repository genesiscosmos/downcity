/** payment 服务按数据库 schema_id 选择表声明。 */
import type { ServiceDatabaseSchemas } from "@downcity/federation";
import { paymentPayments, paymentCardPlans, paymentFulfillments, paymentEvents } from "./schema.js";
import { paymentInbox } from "./inbox-schema.js";
import { pg_payment_payments, pg_payment_card_plans, pg_payment_fulfillments, pg_payment_events } from "./postgres-schema.js";
import { pg_payment_inbox } from "./postgres-inbox-schema.js";

/** SQLite/D1 与 PostgreSQL 共用的领域表映射。 */
export const payment_database_schemas: ServiceDatabaseSchemas = {
  sqlite: { tables: {
    payments: paymentPayments,
    card_plans: paymentCardPlans,
    fulfillments: paymentFulfillments,
    events: paymentEvents,
    inbox: paymentInbox
  } },
  postgresql: { tables: {
    payments: pg_payment_payments,
    card_plans: pg_payment_card_plans,
    fulfillments: pg_payment_fulfillments,
    events: pg_payment_events,
    inbox: pg_payment_inbox
  } },
};
