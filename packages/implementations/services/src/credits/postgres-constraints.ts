/** PostgreSQL 账务约束：显式准备阶段验证历史行，并为后续写入建立数据库保护。 */

import type { CreditsRawCommand } from "./types/RawDatabase.js";

/** 通用建表器之外必须显式安装的 PostgreSQL CHECK 约束。 */
export function postgres_credits_constraints(): CreditsRawCommand[] {
  const constraints = [
    ["service_credits_primary_cards", "service_credits_primary_cards_credits_nonnegative", "credits >= 0"],
    ["service_credits_ephemeral_cards", "service_credits_ephemeral_cards_credits_nonnegative", "credits >= 0"],
    ["service_credits_transactions", "service_credits_transactions_kind_check", "kind IN ('topup', 'charge')"],
    ["service_credits_transactions", "service_credits_transactions_status_check", "status IN ('pending', 'applied')"],
    ["service_credits_transaction_entries", "service_credits_transaction_entries_card_kind_check", "card_kind IN ('primary', 'ephemeral')"],
  ].map(([table_name, constraint_name, expression]) => ({
    sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${table_name}'::regclass AND conname = '${constraint_name}') THEN ALTER TABLE ${table_name} ADD CONSTRAINT ${constraint_name} CHECK (${expression}); END IF; END $$`,
    params: [],
  }));
  return [
    {
      sql: 'ALTER TABLE service_credits_transaction_entries ADD COLUMN IF NOT EXISTS ledger_sequence bigserial NOT NULL',
      params: [],
    },
    ...constraints,
  ];
}
