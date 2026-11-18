/** Federation 设备登录会话表；刷新秘密仅以 SHA-256 摘要保存。 */
import { pgTable, text as pg_text, bigint } from "drizzle-orm/pg-core";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** SQLite / D1 登录会话。 */
export const sqlite_user_sessions = sqliteTable("federation_user_sessions", {
  session_id: text("session_id").primaryKey(),
  user_id: text("user_id").notNull(),
  token_hash: text("token_hash").notNull(),
  previous_hash: text("previous_hash").notNull(),
  refresh_id_hash: text("refresh_id_hash").notNull(),
  expires_at: integer("expires_at").notNull(),
  revoked: integer("revoked").notNull(),
});
/** PostgreSQL 登录会话，与 SQLite 使用相同的毫秒时间语义。 */
export const pg_user_sessions = pgTable("federation_user_sessions", {
  session_id: pg_text("session_id").primaryKey(),
  user_id: pg_text("user_id").notNull(),
  token_hash: pg_text("token_hash").notNull(),
  previous_hash: pg_text("previous_hash").notNull(),
  refresh_id_hash: pg_text("refresh_id_hash").notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
  revoked: bigint("revoked", { mode: "number" }).notNull(),
});
