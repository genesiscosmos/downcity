/**
 * Relay 的 PostgreSQL 持久化结构。
 *
 * 模型白名单使用 JSONB，由 Drizzle 编解码；冷却时间是 Unix 毫秒，必须使用
 * bigint。其余时间沿用 ISO 文本，避免驱动返回 Date 改变领域记录形状。
 */
import { bigint, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

/** API Key 摘要与授权范围。 */
export const pg_relay_keys = pgTable("service_ai_relay_keys", {
  key_id: text("key_id").primaryKey(),
  user_id: text("user_id").notNull(),
  digest: text("digest").notNull().unique(),
  prefix: text("prefix").notNull(),
  name: text("name").notNull(),
  allowed_models: jsonb("allowed_models").notNull(),
  spend_limit: bigint("spend_limit", { mode: "number" }),
  expires_at: text("expires_at"),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
}, (table) => ({ user: index("service_ai_relay_keys_user_idx").on(table.user_id) }));

/** 乐观并发控制的目录快照。 */
export const pg_relay_catalog = pgTable("service_ai_relay_catalog", {
  id: text("id").primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  catalog_json: text("catalog_json").notNull(),
});

/** 跨实例共享的部署冷却时间。 */
export const pg_relay_health = pgTable("service_ai_relay_health", {
  deployment_id: text("deployment_id").primaryKey(),
  cooldown_until: bigint("cooldown_until", { mode: "number" }).notNull(),
});

/** 请求日志，与结算记录按 request_id 关联。 */
export const pg_relay_requests = pgTable("service_ai_relay_requests", {
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

/** 每次上游尝试的状态与耗时。 */
export const pg_relay_attempts = pgTable("service_ai_relay_attempts", {
  attempt_id: text("attempt_id").primaryKey(),
  request_id: text("request_id").notNull(),
  deployment_id: text("deployment_id").notNull(),
  channel_id: text("channel_id").notNull(),
  upstream_model: text("upstream_model").notNull(),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  http_status: integer("http_status"),
  status: text("status").notNull(),
  first_output_ms: bigint("first_output_ms", { mode: "number" }),
}, (table) => ({ request: index("service_ai_relay_attempts_request_idx").on(table.request_id) }));

/**
 * Relay 自有索引；当前 PG Adapter 的通用建表仅处理列，因此显式声明幂等 DDL。
 * AIService 在部署准备阶段、表创建完成后落实索引，请求阶段仅绑定运行时。
 */
export const pg_relay_index_ddl = [
  "CREATE UNIQUE INDEX IF NOT EXISTS service_ai_relay_keys_digest_unique ON service_ai_relay_keys (digest)",
  "CREATE INDEX IF NOT EXISTS service_ai_relay_keys_user_idx ON service_ai_relay_keys (user_id)",
  "CREATE INDEX IF NOT EXISTS service_ai_relay_requests_user_started_idx ON service_ai_relay_requests (user_id, started_at)",
  "CREATE INDEX IF NOT EXISTS service_ai_relay_requests_key_idx ON service_ai_relay_requests (key_id)",
  "CREATE INDEX IF NOT EXISTS service_ai_relay_attempts_request_idx ON service_ai_relay_attempts (request_id)",
];

/** AIService 的局部表名必须与 SQLite 声明一致。 */
export const pg_relay_tables = {
  relay_keys: pg_relay_keys,
  relay_catalog: pg_relay_catalog,
  relay_health: pg_relay_health,
  relay_requests: pg_relay_requests,
  relay_attempts: pg_relay_attempts,
};
