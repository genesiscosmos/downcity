/**
 * Env 数据库 schema 模块。
 *
 * 定义 Downcity 内置的 Env 表结构（SQLite + Postgres）。
 * Env 表存储运行时环境变量，优先级高于 `.env` 文件。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const DEFAULT_ENV_TABLE = "env";

/**
 * 默认 SQLite Env 表。
 */
export const sqliteEnv = sqliteTable(DEFAULT_ENV_TABLE, {
  /**
   * Env key。
   */
  key: sqliteText("key").primaryKey(),

  /**
   * Env value。
   */
  value: sqliteText("value").notNull(),

  /**
   * 创建时间。
   */
  created_at: sqliteText("created_at").notNull(),

  /**
   * 更新时间。
   */
  updated_at: sqliteText("updated_at").notNull(),
});

/**
 * 默认 Postgres Env 表。
 */
export const pgEnv = pgTable(DEFAULT_ENV_TABLE, {
  /**
   * Env key。
   */
  key: pgText("key").primaryKey(),

  /**
   * Env value。
   */
  value: pgText("value").notNull(),

  /**
   * 创建时间。
   */
  created_at: pgText("created_at").notNull(),

  /**
   * 更新时间。
   */
  updated_at: pgText("updated_at").notNull(),
});
