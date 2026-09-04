/**
 * Feedback 服务数据表结构。
 *
 * 关键说明（中文）
 * - 本期反馈能力使用单表模型，便于官方和其它 city 复用
 * - 所有字段保持 not null，可空语义统一用空字符串表达
 * - metadata_json 保存客户端页面、版本、浏览器等上下文信息
 */

import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 用户反馈消息表。
 */
export const feedbackMessages = sqliteTable("service_feedback_messages", {
  feedback_id: text("feedback_id").primaryKey(),
  bureau_id: text("bureau_id").notNull(),
  user_id: text("user_id").notNull(),
  message: text("message").notNull(),
  contact: text("contact").notNull(),
  status: text("status").notNull(),
  reply: text("reply").notNull(),
  reply_by: text("reply_by").notNull(),
  replied_at: text("replied_at").notNull(),
  metadata_json: text("metadata_json").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
