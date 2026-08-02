/**
 * Federation Bureau Token 数据库表。
 *
 * 只保存 Token hash 和生命周期状态，不持久化 Bureau Token 明文。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const BUREAU_TOKEN_TABLE = "federation_bureau_tokens";

/** Federation SQLite Bureau Token 表。 */
export const sqlite_bureau_tokens = sqliteTable(BUREAU_TOKEN_TABLE, {
  /** Bureau Token 查找 ID。 */
  token_id: sqliteText("token_id").primaryKey(),
  /** Token 所属的稳定 Bureau ID。 */
  bureau_id: sqliteText("bureau_id").notNull(),
  /** Token 对应的部署位置或业务用途。 */
  purpose: sqliteText("purpose").notNull().default(""),
  /** Token SHA-256 Base64URL hash。 */
  token_hash: sqliteText("token_hash").notNull(),
  /** active 或 revoked。 */
  status: sqliteText("status").notNull(),
  /** 创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
});

/** Federation Postgres Bureau Token 表。 */
export const pg_bureau_tokens = pgTable(BUREAU_TOKEN_TABLE, {
  /** Bureau Token 查找 ID。 */
  token_id: pgText("token_id").primaryKey(),
  /** Token 所属的稳定 Bureau ID。 */
  bureau_id: pgText("bureau_id").notNull(),
  /** Token 对应的部署位置或业务用途。 */
  purpose: pgText("purpose").notNull().default(""),
  /** Token SHA-256 Base64URL hash。 */
  token_hash: pgText("token_hash").notNull(),
  /** active 或 revoked。 */
  status: pgText("status").notNull(),
  /** 创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: pgText("updated_at").notNull(),
});
