/**
 * AI 技术用量与可靠结算的 PostgreSQL 表。
 *
 * 时间和结算负载沿用领域的 ISO 字符串与 JSON 文本语义；计数采用 bigint
 * 并映射为 number，避免 PG 的 32 位 integer 限制，与 SQLite 数值行为一致。
 */
import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";

/** AI 技术用量事实，索引与 SQLite 表保持一致。 */
export const pg_ai_usage_records = pgTable("service_ai_usage_records", {
  usage_id: text("usage_id").primaryKey(),
  user_id: text("user_id"),
  bureau_id: text("bureau_id"),
  action_id: text("action_id").notNull(),
  model_id: text("model_id").notNull(),
  channel_id: text("channel_id"),
  upstream_model: text("upstream_model"),
  metering_status: text("metering_status").notNull(),
  outcome: text("outcome").notNull(),
  uncached_input_tokens: bigint("uncached_input_tokens", { mode: "number" }),
  cached_input_tokens: bigint("cached_input_tokens", { mode: "number" }),
  output_tokens: bigint("output_tokens", { mode: "number" }),
  reasoning_tokens: bigint("reasoning_tokens", { mode: "number" }),
  image_count: bigint("image_count", { mode: "number" }),
  video_seconds: bigint("video_seconds", { mode: "number" }),
  audio_seconds: bigint("audio_seconds", { mode: "number" }),
  request_count: bigint("request_count", { mode: "number" }),
  duration_ms: bigint("duration_ms", { mode: "number" }),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at").notNull(),
  created_at: text("created_at").notNull(),
}, (table) => ({
  user_completed: index("service_ai_usage_records_user_completed_idx")
    .on(table.user_id, table.completed_at),
  user_metering_completed: index("service_ai_usage_records_user_metering_completed_idx")
    .on(table.user_id, table.metering_status, table.completed_at),
}));

/** Usage 与积分扣款的可靠结算任务，租约使用文本保存 ISO 时间。 */
export const pg_ai_settlement_jobs = pgTable("service_ai_settlement_jobs", {
  usage_id: text("usage_id").primaryKey(),
  status: text("status").notNull(),
  payload_json: text("payload_json").notNull(),
  attempt_count: bigint("attempt_count", { mode: "number" }).notNull(),
  next_attempt_at: text("next_attempt_at").notNull(),
  lease_token: text("lease_token").notNull(),
  lease_expires_at: text("lease_expires_at").notNull(),
  last_error_code: text("last_error_code").notNull(),
  last_error_message: text("last_error_message").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  completed_at: text("completed_at").notNull(),
}, (table) => ({
  status_next_attempt: index("service_ai_settlement_jobs_status_next_attempt_idx")
    .on(table.status, table.next_attempt_at),
}));
