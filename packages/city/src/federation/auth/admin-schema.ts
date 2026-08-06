/**
 * Federation 管理员身份与会话系统表。
 *
 * 管理员密码只保存跨运行时 PBKDF2 摘要；管理会话只保存高熵 Token 的 SHA-256
 * 摘要。`owner` 固定槽位保证一个 Federation 只有一个基础设施可恢复的管理员。
 */

import { pgTable, text as pgText, uniqueIndex as pgUniqueIndex } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText, uniqueIndex as sqliteUniqueIndex } from "drizzle-orm/sqlite-core";

const FEDERATION_ADMINISTRATOR_TABLE = "federation_administrators";
const FEDERATION_ADMIN_SESSION_TABLE = "federation_admin_sessions";

/** Federation SQLite 管理员表。 */
export const sqlite_federation_administrators = sqliteTable(FEDERATION_ADMINISTRATOR_TABLE, {
  /** 固定管理员所有权槽位，当前仅允许 `owner`。 */
  owner_slot: sqliteText("owner_slot").primaryKey(),
  /** 管理员登录 ID。 */
  admin_id: sqliteText("admin_id").notNull(),
  /** 带算法、迭代次数和盐值的密码摘要。 */
  password_hash: sqliteText("password_hash").notNull(),
  /** 管理员生命周期状态。 */
  status: sqliteText("status").notNull(),
  /** 连续登录失败次数。 */
  failed_attempts: sqliteText("failed_attempts").notNull(),
  /** 登录锁定结束时间；未锁定时为空字符串。 */
  locked_until: sqliteText("locked_until").notNull(),
  /** 最近一次已应用的部署 provisioning ID。 */
  provision_id: sqliteText("provision_id").notNull(),
  /** 管理员创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 管理员资料更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
}, (table) => [sqliteUniqueIndex("federation_administrators_admin_id").on(table.admin_id)]);

/** Federation PostgreSQL 管理员表。 */
export const pg_federation_administrators = pgTable(FEDERATION_ADMINISTRATOR_TABLE, {
  /** 固定管理员所有权槽位，当前仅允许 `owner`。 */
  owner_slot: pgText("owner_slot").primaryKey(),
  /** 管理员登录 ID。 */
  admin_id: pgText("admin_id").notNull(),
  /** 带算法、迭代次数和盐值的密码摘要。 */
  password_hash: pgText("password_hash").notNull(),
  /** 管理员生命周期状态。 */
  status: pgText("status").notNull(),
  /** 连续登录失败次数。 */
  failed_attempts: pgText("failed_attempts").notNull(),
  /** 登录锁定结束时间；未锁定时为空字符串。 */
  locked_until: pgText("locked_until").notNull(),
  /** 最近一次已应用的部署 provisioning ID。 */
  provision_id: pgText("provision_id").notNull(),
  /** 管理员创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 管理员资料更新时间。 */
  updated_at: pgText("updated_at").notNull(),
}, (table) => [pgUniqueIndex("federation_administrators_admin_id").on(table.admin_id)]);

/** Federation SQLite 管理员会话表。 */
export const sqlite_federation_admin_sessions = sqliteTable(FEDERATION_ADMIN_SESSION_TABLE, {
  /** 会话公开 ID。 */
  session_id: sqliteText("session_id").primaryKey(),
  /** 会话所属管理员 ID。 */
  admin_id: sqliteText("admin_id").notNull(),
  /** 管理 Session Token 的 SHA-256 摘要。 */
  token_hash: sqliteText("token_hash").notNull(),
  /** 会话生命周期状态。 */
  status: sqliteText("status").notNull(),
  /** 会话创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 会话到期时间。 */
  expires_at: sqliteText("expires_at").notNull(),
  /** 最近一次通过鉴权的时间。 */
  last_seen_at: sqliteText("last_seen_at").notNull(),
  /** 会话撤销时间；仍有效时为空字符串。 */
  revoked_at: sqliteText("revoked_at").notNull(),
}, (table) => [sqliteUniqueIndex("federation_admin_sessions_token_hash").on(table.token_hash)]);

/** Federation PostgreSQL 管理员会话表。 */
export const pg_federation_admin_sessions = pgTable(FEDERATION_ADMIN_SESSION_TABLE, {
  /** 会话公开 ID。 */
  session_id: pgText("session_id").primaryKey(),
  /** 会话所属管理员 ID。 */
  admin_id: pgText("admin_id").notNull(),
  /** 管理 Session Token 的 SHA-256 摘要。 */
  token_hash: pgText("token_hash").notNull(),
  /** 会话生命周期状态。 */
  status: pgText("status").notNull(),
  /** 会话创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 会话到期时间。 */
  expires_at: pgText("expires_at").notNull(),
  /** 最近一次通过鉴权的时间。 */
  last_seen_at: pgText("last_seen_at").notNull(),
  /** 会话撤销时间；仍有效时为空字符串。 */
  revoked_at: pgText("revoked_at").notNull(),
}, (table) => [pgUniqueIndex("federation_admin_sessions_token_hash").on(table.token_hash)]);
