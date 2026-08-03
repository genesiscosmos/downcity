/**
 * Federation Bureau 数据库 Schema。
 *
 * Bureau 身份与其唯一 Server 配置分别持久化，并通过 bureau_id 一对一关联。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const BUREAU_TABLE = "federation_bureaus";
const BUREAU_SERVER_TABLE = "federation_bureau_servers";

/** Federation SQLite Bureau 表。 */
export const sqlite_bureaus = sqliteTable(BUREAU_TABLE, {
  /** 稳定 Bureau ID。 */
  bureau_id: sqliteText("bureau_id").primaryKey(),
  /** Bureau 展示名称。 */
  name: sqliteText("name").notNull(),
  /** active、paused 或 archived。 */
  state: sqliteText("state").notNull(),
  /** 创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
  /** 归档时间；未归档时为空字符串。 */
  archived_at: sqliteText("archived_at").notNull().default(""),
});

/** Federation SQLite Bureau Server 表。 */
export const sqlite_bureau_servers = sqliteTable(BUREAU_SERVER_TABLE, {
  /** Bureau ID，同时作为一对一 Server 记录主键。 */
  bureau_id: sqliteText("bureau_id").primaryKey().references(() => sqlite_bureaus.bureau_id),
  /** 当前 Server 的 HTTP(S) 服务入口。 */
  server_url: sqliteText("server_url").notNull(),
  /** 创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
});

/** Federation PostgreSQL Bureau 表。 */
export const pg_bureaus = pgTable(BUREAU_TABLE, {
  /** 稳定 Bureau ID。 */
  bureau_id: pgText("bureau_id").primaryKey(),
  /** Bureau 展示名称。 */
  name: pgText("name").notNull(),
  /** active、paused 或 archived。 */
  state: pgText("state").notNull(),
  /** 创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: pgText("updated_at").notNull(),
  /** 归档时间；未归档时为空字符串。 */
  archived_at: pgText("archived_at").notNull().default(""),
});

/** Federation PostgreSQL Bureau Server 表。 */
export const pg_bureau_servers = pgTable(BUREAU_SERVER_TABLE, {
  /** Bureau ID，同时作为一对一 Server 记录主键。 */
  bureau_id: pgText("bureau_id").primaryKey().references(() => pg_bureaus.bureau_id),
  /** 当前 Server 的 HTTP(S) 服务入口。 */
  server_url: pgText("server_url").notNull(),
  /** 创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: pgText("updated_at").notNull(),
});
