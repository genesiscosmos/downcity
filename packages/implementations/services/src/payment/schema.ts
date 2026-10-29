/**
 * Payment 统一数据库 schema。
 *
 * 关键说明（中文）
 * - payment 是唯一支付服务，provider 只作为支付实现存在。
 * - 所有 provider 共用 payments / events 两张表，便于统一查询、排障和入账。
 * - provider-specific ID 统一放到 provider_session_id / provider_payment_id / provider_order_id。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 统一支付记录表。
 */
export const paymentPayments = sqliteTable("service_payment_payments", {
  payment_id: text("payment_id").primaryKey(),
  provider: text("provider").notNull(),
  user_id: text("user_id").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  provider_session_id: text("provider_session_id").notNull(),
  provider_payment_id: text("provider_payment_id").notNull(),
  provider_order_id: text("provider_order_id").notNull(),
  credits: integer("credits").notNull(),
  amount_minor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  checkout_url: text("checkout_url").notNull(),
  note: text("note").notNull(),
  metadata_json: text("metadata_json").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * 统一支付 webhook 事件表。
 */
/** 持久化套餐，停售不删除历史引用。 */
export const paymentCardPlans = sqliteTable("service_payment_card_plans", {
  plan_id: text("plan_id").primaryKey(), name: text("name").notNull(), currency: text("currency").notNull(),
  amount_minor: integer("amount_minor").notNull(), credits: integer("credits").notNull(), duration_seconds: integer("duration_seconds").notNull(),
  enabled: integer("enabled").notNull(), version: integer("version").notNull(), created_at: text("created_at").notNull(), updated_at: text("updated_at").notNull(),
});
/** 独立支付履约日志，稳定起点与并发租约不依赖 webhook 次数。 */
export const paymentFulfillments = sqliteTable("service_payment_fulfillments", {
  payment_id: text("payment_id").primaryKey(), user_id: text("user_id").notNull(), status: text("status").notNull(),
  started_at: text("started_at").notNull(), expires_at: text("expires_at").notNull(), lease: text("lease").notNull(),
  lease_until: integer("lease_until").notNull(), fulfilled_at: text("fulfilled_at").notNull(),
});

export const paymentEvents = sqliteTable("service_payment_events", {
  event_id: text("event_id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  payload_json: text("payload_json").notNull(),
  sync_status: text("sync_status").notNull(),
  sync_error: text("sync_error").notNull(),
  created_at: text("created_at").notNull(),
});
