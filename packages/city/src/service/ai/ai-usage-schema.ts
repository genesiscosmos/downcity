/**
 * AI Usage 与可靠结算任务数据库结构。
 *
 * Usage Record 使用独立数值列支持范围查询；Settlement Job 的 JSON 仅作为
 * 可靠执行负载，不参与用户侧统计。
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** AI 技术用量事实表。 */
export const ai_usage_records = sqliteTable("service_ai_usage_records", {
  usage_id: text("usage_id").primaryKey(),
  user_id: text("user_id"),
  bureau_id: text("bureau_id"),
  action_id: text("action_id").notNull(),
  model_id: text("model_id").notNull(),
  channel_id: text("channel_id"),
  upstream_model: text("upstream_model"),
  metering_status: text("metering_status").notNull(),
  outcome: text("outcome").notNull(),
  uncached_input_tokens: integer("uncached_input_tokens"),
  cached_input_tokens: integer("cached_input_tokens"),
  output_tokens: integer("output_tokens"),
  reasoning_tokens: integer("reasoning_tokens"),
  image_count: integer("image_count"),
  video_seconds: integer("video_seconds"),
  audio_seconds: integer("audio_seconds"),
  request_count: integer("request_count"),
  duration_ms: integer("duration_ms"),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at").notNull(),
  created_at: text("created_at").notNull(),
}, (table) => ({
  user_completed: index("service_ai_usage_records_user_completed_idx")
    .on(table.user_id, table.completed_at),
  user_metering_completed: index("service_ai_usage_records_user_metering_completed_idx")
    .on(table.user_id, table.metering_status, table.completed_at),
}));

/** AI Usage 与 Credits Charge 的可靠结算任务表。 */
export const ai_settlement_jobs = sqliteTable("service_ai_settlement_jobs", {
  usage_id: text("usage_id").primaryKey(),
  status: text("status").notNull(),
  payload_json: text("payload_json").notNull(),
  attempt_count: integer("attempt_count").notNull(),
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
