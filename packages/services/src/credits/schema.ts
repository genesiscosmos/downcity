/**
 * Credits 服务数据库结构。
 *
 * Primary 与 Ephemeral Card 分表维护各自不变量；Transaction 是业务变动与幂等边界，
 * Transaction Entry 是不可变 Card 流水。
 */

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const PRIMARY_CARD_TABLE = "service_credits_primary_cards";
export const EPHEMERAL_CARD_TABLE = "service_credits_ephemeral_cards";
export const TRANSACTION_TABLE = "service_credits_transactions";
export const TRANSACTION_ENTRY_TABLE = "service_credits_transaction_entries";

/** 用户唯一的永久 Credits Card。 */
export const creditsPrimaryCards = sqliteTable(PRIMARY_CARD_TABLE, {
  /** 用户 ID，同时也是 Primary Card 主键。 */
  user_id: text("user_id").primaryKey(),
  /** 当前永久额度。 */
  credits: integer("credits").notNull(),
  /** 当前原子写操作占用标记；只供内部事务回滚使用。 */
  transaction_marker: text("transaction_marker").notNull(),
  /** 创建时间。 */
  created_at: text("created_at").notNull(),
  /** 更新时间。 */
  updated_at: text("updated_at").notNull(),
}, (table) => ({
  /** 数据库层禁止 Primary Card 出现负余额。 */
  credits_nonnegative: check("service_credits_primary_cards_credits_nonnegative", sql`${table.credits} >= 0`),
}));

/** 用户的一张限时 Credits Card。 */
export const creditsEphemeralCards = sqliteTable(EPHEMERAL_CARD_TABLE, {
  /** Card 唯一 ID。 */
  card_id: text("card_id").primaryKey(),
  /** Card 所属用户 ID。 */
  user_id: text("user_id").notNull(),
  /** Card 展示名称。 */
  name: text("name").notNull(),
  /** 当前剩余额度。 */
  credits: integer("credits").notNull(),
  /** Card 到期时间。 */
  expires_at: text("expires_at").notNull(),
  /** Card 创建来源。 */
  source: text("source").notNull(),
  /** 外部业务记录 ID。 */
  ref: text("ref").notNull(),
  /** 当前原子写操作占用标记；只供内部事务回滚使用。 */
  transaction_marker: text("transaction_marker").notNull(),
  /** 创建时间。 */
  created_at: text("created_at").notNull(),
  /** 更新时间。 */
  updated_at: text("updated_at").notNull(),
}, (table) => ({
  /** 用户与到期时间查询索引。 */
  user_expires: index("service_credits_ephemeral_cards_user_expires_idx")
    .on(table.user_id, table.expires_at),
  /** 数据库层禁止 Ephemeral Card 出现负余额。 */
  credits_nonnegative: check("service_credits_ephemeral_cards_credits_nonnegative", sql`${table.credits} >= 0`),
}));

/** 一次完整 Credits 变动与幂等边界。 */
export const creditsTransactions = sqliteTable(TRANSACTION_TABLE, {
  /** Transaction 唯一 ID。 */
  transaction_id: text("transaction_id").primaryKey(),
  /** topup 或 charge。 */
  kind: text("kind").notNull(),
  /** Transaction 所属用户 ID。 */
  user_id: text("user_id").notNull(),
  /** 本次变动总额度。 */
  credits: integer("credits").notNull(),
  /** pending 或 applied。 */
  status: text("status").notNull(),
  /** 调用方稳定幂等键。 */
  idempotency_key: text("idempotency_key").notNull(),
  /** 标准化后的关键请求 JSON。 */
  request_json: text("request_json").notNull(),
  /** 业务来源。 */
  source: text("source").notNull(),
  /** 外部业务记录 ID。 */
  ref: text("ref").notNull(),
  /** 人类可读说明。 */
  note: text("note").notNull(),
  /** 结构化审计信息。 */
  metadata_json: text("metadata_json").notNull(),
  /** 创建时间。 */
  created_at: text("created_at").notNull(),
  /** 完成时间；pending 时为空字符串。 */
  applied_at: text("applied_at").notNull(),
}, (table) => ({
  /** 同一种 Transaction 内的幂等唯一约束。 */
  kind_idempotency: uniqueIndex("service_credits_transactions_kind_idempotency_idx")
    .on(table.kind, table.idempotency_key),
  /** 用户 Transaction 时间线查询索引。 */
  user_created: index("service_credits_transactions_user_created_idx")
    .on(table.user_id, table.created_at),
  /** 仅允许当前服务定义的 Transaction 类型。 */
  valid_kind: check("service_credits_transactions_kind_check", sql`${table.kind} IN ('topup', 'charge')`),
  /** 仅允许内部生命周期状态。 */
  valid_status: check("service_credits_transactions_status_check", sql`${table.status} IN ('pending', 'applied')`),
}));

/** Transaction 对一张 Card 的不可变额度变化。 */
export const creditsTransactionEntries = sqliteTable(TRANSACTION_ENTRY_TABLE, {
  /** Entry 唯一 ID。 */
  entry_id: text("entry_id").primaryKey(),
  /** 所属 Transaction ID。 */
  transaction_id: text("transaction_id").notNull(),
  /** Card 所属用户 ID。 */
  user_id: text("user_id").notNull(),
  /** primary 或 ephemeral。 */
  card_kind: text("card_kind").notNull(),
  /** Primary 使用 user_id，Ephemeral 使用 card_id。 */
  card_id: text("card_id").notNull(),
  /** 本条额度变化。 */
  credits_delta: integer("credits_delta").notNull(),
  /** 变化后的 Card 余额。 */
  credits_after: integer("credits_after").notNull(),
  /** 创建时间。 */
  created_at: text("created_at").notNull(),
}, (table) => ({
  /** 按 Transaction 读取全部 Entries。 */
  transaction: index("service_credits_transaction_entries_transaction_idx")
    .on(table.transaction_id),
  /** 按用户读取 Card 流水。 */
  user_created: index("service_credits_transaction_entries_user_created_idx")
    .on(table.user_id, table.created_at),
  /** Entry 只能指向受支持的 Card 类型。 */
  valid_card_kind: check("service_credits_transaction_entries_card_kind_check", sql`${table.card_kind} IN ('primary', 'ephemeral')`),
}));
