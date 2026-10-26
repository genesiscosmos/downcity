/**
 * AI 中转持久化结构。
 * 全部表由 AIService 声明并通过 Federation 数据库初始化；Key 只保存摘要，
 * 渠道只保存环境变量引用。日志与既有结算任务通过 request_id/usage_id 关联。
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const relay_keys = sqliteTable("service_ai_relay_keys", {
  key_id: text("key_id").primaryKey(),
  user_id: text("user_id").notNull(),
  digest: text("digest").notNull().unique(),
  prefix: text("prefix").notNull(),
  name: text("name").notNull(),
  allowed_models: text("allowed_models", { mode: "json" }).notNull(),
  spend_limit: integer("spend_limit"),
  expires_at: text("expires_at"),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
}, (table) => ({ user: index("service_ai_relay_keys_user_idx").on(table.user_id) }));

export const relay_catalog = sqliteTable("service_ai_relay_catalog", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  catalog_json: text("catalog_json").notNull(),
});

export const relay_health = sqliteTable("service_ai_relay_health", {
  deployment_id: text("deployment_id").primaryKey(),
  cooldown_until: integer("cooldown_until").notNull(),
});

export const relay_requests = sqliteTable("service_ai_relay_requests", {
  request_id: text("request_id").primaryKey(),
  user_id: text("user_id").notNull(),
  key_id: text("key_id"),
  requested_model: text("requested_model").notNull(),
  model_id: text("model_id").notNull(),
  status: text("status").notNull(),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
}, (table) => ({
  user: index("service_ai_relay_requests_user_started_idx").on(table.user_id, table.started_at),
  key: index("service_ai_relay_requests_key_idx").on(table.key_id),
}));

export const relay_attempts = sqliteTable("service_ai_relay_attempts", {
  attempt_id: text("attempt_id").primaryKey(),
  request_id: text("request_id").notNull(),
  deployment_id: text("deployment_id").notNull(),
  channel_id: text("channel_id").notNull(),
  upstream_model: text("upstream_model").notNull(),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  http_status: integer("http_status"),
  status: text("status").notNull(),
  first_output_ms: integer("first_output_ms"),
}, (table) => ({ request: index("service_ai_relay_attempts_request_idx").on(table.request_id) }));

/** AIService 局部表名称与 Schema。 */
export const relay_tables = { relay_keys, relay_catalog, relay_health, relay_requests, relay_attempts };
