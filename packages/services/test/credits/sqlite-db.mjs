/**
 * Credits 测试专用 SQLite 数据库工厂。
 */

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

export function createSqliteDb(filepath) {
  const sqlite = new Database(filepath)
  sqlite.pragma("journal_mode = WAL")
  return drizzle(sqlite)
}
