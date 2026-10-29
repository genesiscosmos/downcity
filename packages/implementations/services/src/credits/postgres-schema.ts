/** credits PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { PRIMARY_CARD_TABLE, EPHEMERAL_CARD_TABLE, TRANSACTION_TABLE, TRANSACTION_ENTRY_TABLE } from "./schema.js";
import { sql } from "drizzle-orm";
import { check, index, bigserial, bigint, boolean, timestamp, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
export const pg_credits_primary_cards = pgTable(PRIMARY_CARD_TABLE, {
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").primaryKey(),
  /** credits 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits: bigint("credits", { mode: "number" }).notNull(),
  /** transaction_marker 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  transaction_marker: text("transaction_marker").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
}, (table) => ({
  credits_nonnegative: check("service_credits_primary_cards_credits_nonnegative", sql`${table.credits} >= 0`),
}));
export const pg_credits_ephemeral_cards = pgTable(EPHEMERAL_CARD_TABLE, {
  /** card_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  card_id: text("card_id").primaryKey(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** name 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  name: text("name").notNull(),
  /** credits 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits: bigint("credits", { mode: "number" }).notNull(),
  /** expires_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expires_at: text("expires_at").notNull(),
  /** source 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  source: text("source").notNull(),
  /** ref 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  ref: text("ref").notNull(),
  /** transaction_marker 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  transaction_marker: text("transaction_marker").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
}, (table) => ({
  user_expires: index("service_credits_ephemeral_cards_user_expires_idx")
    .on(table.user_id, table.expires_at),
  credits_nonnegative: check("service_credits_ephemeral_cards_credits_nonnegative", sql`${table.credits} >= 0`),
}));
export const pg_credits_transactions = pgTable(TRANSACTION_TABLE, {
  /** transaction_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  transaction_id: text("transaction_id").primaryKey(),
  /** kind 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  kind: text("kind").notNull(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** credits 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits: bigint("credits", { mode: "number" }).notNull(),
  /** status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  status: text("status").notNull(),
  /** idempotency_key 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  idempotency_key: text("idempotency_key").notNull(),
  /** request_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  request_json: text("request_json").notNull(),
  /** source 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  source: text("source").notNull(),
  /** ref 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  ref: text("ref").notNull(),
  /** note 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  note: text("note").notNull(),
  /** metadata_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  metadata_json: text("metadata_json").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** applied_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  applied_at: text("applied_at").notNull(),
}, (table) => ({
  kind_idempotency: uniqueIndex("service_credits_transactions_kind_idempotency_idx")
    .on(table.kind, table.idempotency_key),
  user_created: index("service_credits_transactions_user_created_idx")
    .on(table.user_id, table.created_at),
  valid_kind: check("service_credits_transactions_kind_check", sql`${table.kind} IN ('topup', 'charge')`),
  valid_status: check("service_credits_transactions_status_check", sql`${table.status} IN ('pending', 'applied')`),
}));
export const pg_credits_transaction_entries = pgTable(TRANSACTION_ENTRY_TABLE, {
  /** PostgreSQL 流水插入顺序；历史导入按原 SQLite rowid 顺序写入。 */
  ledger_sequence: bigserial("ledger_sequence", { mode: "number" }).notNull(),
  /** entry_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  entry_id: text("entry_id").primaryKey(),
  /** transaction_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  transaction_id: text("transaction_id").notNull(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** card_kind 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  card_kind: text("card_kind").notNull(),
  /** card_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  card_id: text("card_id").notNull(),
  /** credits_delta 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits_delta: bigint("credits_delta", { mode: "number" }).notNull(),
  /** credits_after 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits_after: bigint("credits_after", { mode: "number" }).notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
}, (table) => ({
  transaction: index("service_credits_transaction_entries_transaction_idx")
    .on(table.transaction_id),
  user_created: index("service_credits_transaction_entries_user_created_idx")
    .on(table.user_id, table.created_at),
  valid_card_kind: check("service_credits_transaction_entries_card_kind_check", sql`${table.card_kind} IN ('primary', 'ephemeral')`),
}));
