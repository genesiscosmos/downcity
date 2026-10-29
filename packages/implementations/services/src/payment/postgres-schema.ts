/** payment PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { bigint, boolean, timestamp, pgTable, text } from "drizzle-orm/pg-core";
export const pg_payment_payments = pgTable("service_payment_payments", {
  /** payment_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  payment_id: text("payment_id").primaryKey(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** idempotency_key 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  idempotency_key: text("idempotency_key").notNull(),
  /** provider_session_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider_session_id: text("provider_session_id").notNull(),
  /** provider_payment_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider_payment_id: text("provider_payment_id").notNull(),
  /** provider_order_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider_order_id: text("provider_order_id").notNull(),
  /** credits 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits: bigint("credits", { mode: "number" }).notNull(),
  /** amount_minor 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  amount_minor: bigint("amount_minor", { mode: "number" }).notNull(),
  /** currency 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  currency: text("currency").notNull(),
  /** status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  status: text("status").notNull(),
  /** checkout_url 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  checkout_url: text("checkout_url").notNull(),
  /** note 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  note: text("note").notNull(),
  /** metadata_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  metadata_json: text("metadata_json").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
});
export const pg_payment_card_plans = pgTable("service_payment_card_plans", {
  /** plan_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  plan_id: text("plan_id").primaryKey(), /** name 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  name: text("name").notNull(), /** currency 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  currency: text("currency").notNull(),
  /** amount_minor 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  amount_minor: bigint("amount_minor", { mode: "number" }).notNull(), /** credits 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  credits: bigint("credits", { mode: "number" }).notNull(), /** duration_seconds 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  duration_seconds: bigint("duration_seconds", { mode: "number" }).notNull(),
  /** enabled 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  enabled: bigint("enabled", { mode: "number" }).notNull(), /** version 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  version: bigint("version", { mode: "number" }).notNull(), /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(), /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
});
export const pg_payment_fulfillments = pgTable("service_payment_fulfillments", {
  /** payment_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  payment_id: text("payment_id").primaryKey(), /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(), /** status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  status: text("status").notNull(),
  /** started_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  started_at: text("started_at").notNull(), /** expires_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expires_at: text("expires_at").notNull(), /** lease 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  lease: text("lease").notNull(),
  /** lease_until 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  lease_until: bigint("lease_until", { mode: "number" }).notNull(), /** fulfilled_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  fulfilled_at: text("fulfilled_at").notNull(),
});
export const pg_payment_events = pgTable("service_payment_events", {
  /** event_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  event_id: text("event_id").primaryKey(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** type 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  type: text("type").notNull(),
  /** payload_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  payload_json: text("payload_json").notNull(),
  /** sync_status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  sync_status: text("sync_status").notNull(),
  /** sync_error 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  sync_error: text("sync_error").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
});
