/**
 * User Token 撤销表。只持久化已验签 JWT 的 jti 与到期时间，不保存凭证或密钥。
 * 到期时间使用 Unix 秒；到期记录可安全删除，因为 JWT 已不能通过时间校验。
 */
import { pgTable, text as pg_text, bigint as pg_bigint } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqlite_text, integer as sqlite_integer } from "drizzle-orm/sqlite-core";

/** SQLite 当前会话撤销记录。 */
export const sqlite_user_token_revocations = sqliteTable("federation_user_token_revocations", {
  /** 已通过签名验证的 JWT 唯一 ID。 */
  token_id: sqlite_text("token_id").primaryKey(),
  /** JWT 到期时间，Unix 秒。 */
  expires_at: sqlite_integer("expires_at").notNull(),
});

/** Postgres 当前会话撤销记录。 */
export const pg_user_token_revocations = pgTable("federation_user_token_revocations", {
  /** 已通过签名验证的 JWT 唯一 ID。 */
  token_id: pg_text("token_id").primaryKey(),
  /** JWT 到期时间，Unix 秒。 */
  expires_at: pg_bigint("expires_at", { mode: "number" }).notNull(),
});

/** 持久化撤销元数据；不含原始 JWT 或签名材料。 */
export interface UserTokenRevocationRecord extends Record<string, unknown> {
  /** 已通过签名验证的 JWT 唯一 ID。 */
  token_id: string;
  /** JWT 到期时间，Unix 秒；到期后允许清理。 */
  expires_at: number;
}
