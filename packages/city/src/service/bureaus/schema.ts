/**
 * Federation Bureau 数据库 Schema。
 *
 * 每个 Bureau 记录一个稳定产品身份及其唯一服务端入口。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const BUREAU_TABLE = "federation_bureaus";

/** Federation SQLite Bureau 表。 */
export const sqlite_bureaus = sqliteTable(BUREAU_TABLE, {
  /** 稳定 Bureau ID。 */
  bureau_id: sqliteText("bureau_id").primaryKey(),
  /** Bureau 展示名称。 */
  name: sqliteText("name").notNull(),
  /** 当前 Bureau 唯一绑定的服务端入口。 */
  server_url: sqliteText("server_url").notNull(),
  /** active、paused 或 archived。 */
  state: sqliteText("state").notNull(),
  /** 创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
  /** 归档时间；未归档时为空字符串。 */
  archived_at: sqliteText("archived_at").notNull().default(""),
});

/** Federation PostgreSQL Bureau 表。 */
export const pg_bureaus = pgTable(BUREAU_TABLE, {
  /** 稳定 Bureau ID。 */
  bureau_id: pgText("bureau_id").primaryKey(),
  /** Bureau 展示名称。 */
  name: pgText("name").notNull(),
  /** 当前 Bureau 唯一绑定的服务端入口。 */
  server_url: pgText("server_url").notNull(),
  /** active、paused 或 archived。 */
  state: pgText("state").notNull(),
  /** 创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: pgText("updated_at").notNull(),
  /** 归档时间；未归档时为空字符串。 */
  archived_at: pgText("archived_at").notNull().default(""),
});
