/** credits 服务按数据库 schema_id 选择表声明。 */
import type { ServiceDatabaseSchemas } from "@downcity/federation";
import { creditsPrimaryCards, creditsEphemeralCards, creditsTransactions, creditsTransactionEntries } from "./schema.js";
import { pg_credits_primary_cards, pg_credits_ephemeral_cards, pg_credits_transactions, pg_credits_transaction_entries } from "./postgres-schema.js";

/** SQLite/D1 与 PostgreSQL 共用的领域表映射。 */
export const credits_database_schemas: ServiceDatabaseSchemas = {
  sqlite: { tables: {
    primary_cards: creditsPrimaryCards,
    ephemeral_cards: creditsEphemeralCards,
    transactions: creditsTransactions,
    transaction_entries: creditsTransactionEntries
  } },
  postgresql: { tables: {
    primary_cards: pg_credits_primary_cards,
    ephemeral_cards: pg_credits_ephemeral_cards,
    transactions: pg_credits_transactions,
    transaction_entries: pg_credits_transaction_entries
  } },
};
