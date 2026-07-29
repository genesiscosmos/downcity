import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

export function createSqliteDb(filepath) {
  const sqlite = new Database(filepath)
  sqlite.pragma("journal_mode = WAL")
  const db = drizzle(sqlite)
  return Object.assign(db, {
    $client: sqlite,
    raw: sqlite,
  })
}
