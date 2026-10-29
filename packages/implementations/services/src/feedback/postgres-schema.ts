/** feedback PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { pgTable, text } from "drizzle-orm/pg-core";
export const pg_feedback_messages = pgTable("service_feedback_messages", {
  /** feedback_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  feedback_id: text("feedback_id").primaryKey(),
  /** bureau_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  bureau_id: text("bureau_id").notNull(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** message 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  message: text("message").notNull(),
  /** contact 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  contact: text("contact").notNull(),
  /** status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  status: text("status").notNull(),
  /** reply 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  reply: text("reply").notNull(),
  /** reply_by 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  reply_by: text("reply_by").notNull(),
  /** replied_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  replied_at: text("replied_at").notNull(),
  /** metadata_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  metadata_json: text("metadata_json").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
});
