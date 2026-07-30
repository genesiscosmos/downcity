/** City Core 测试专用 SQLite Database。
 *
 * 该 Fixture 只验证 City Database 基类与 Federation 行为，不依赖任何下游
 * Database Adapter Package，避免形成 `city -> database-sqlite -> city` 的测试环。
 */

import BetterSqlite3 from "better-sqlite3"
import { getTableColumns, getTableName } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { Database, TableApi } from "../bin/index.js"

/** 串行协调普通操作与同连接事务。 */
class TestSQLiteCoordinator {
  current = Promise.resolve()

  /** 在前一个数据库操作完成后执行 handler。 */
  async run(handler) {
    const previous = this.current
    let release
    this.current = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await handler()
    } finally {
      release()
    }
  }
}

/** City 测试使用的最小 SQLite Database 子类。 */
class TestSQLiteDatabase extends Database {
  constructor(filename) {
    const client = new BetterSqlite3(filename)
    super({ schema_id: "sqlite", drizzle: drizzle(client) })
    this.client = client
    this.coordinator = new TestSQLiteCoordinator()
  }

  on_table(schema) {
    return new TableApi(this.drizzle, schema, {
      execute: (handler) => this.coordinator.run(handler),
    })
  }

  async on_ensure_table(schema) {
    const ddl = build_create_table_sql(schema)
    if (ddl) this.client.exec(ddl)
  }

  async on_execute_ddl(statement) {
    this.client.exec(statement)
  }

  async on_query(statement) {
    return await this.coordinator.run(async () => {
      const prepared = this.client.prepare(statement.sql)
      if (prepared.reader) {
        return { rows: prepared.all(...statement.params), changes: 0 }
      }
      const result = prepared.run(...statement.params)
      return { rows: [], changes: Number(result.changes ?? 0) }
    })
  }

  async on_atomic(statements) {
    return await this.coordinator.run(async () => {
      const execute = this.client.transaction((commands) => commands.map((command) => {
        const result = this.client.prepare(command.sql).run(...command.params)
        return { changes: Number(result.changes ?? 0) }
      }))
      return execute(statements)
    })
  }

  async on_transaction(handler) {
    return await this.coordinator.run(async () => {
      this.client.exec("BEGIN IMMEDIATE")
      try {
        const result = await handler({
          table: (schema) => new TableApi(this.drizzle, schema),
        })
        this.client.exec("COMMIT")
        return result
      } catch (error) {
        this.client.exec("ROLLBACK")
        throw error
      }
    })
  }

  async on_dispose() {
    this.client.close()
  }
}

/** 创建隔离的 City SQLite 测试数据库。 */
export function createSqliteDb(filename) {
  return new TestSQLiteDatabase(filename)
}

/** 根据 SQLite Drizzle Schema 生成测试建表语句。 */
function build_create_table_sql(schema) {
  const columns = Object.values(getTableColumns(schema))
  if (columns.length === 0) return ""
  const definitions = columns.map((column) => {
    const parts = [quote_identifier(column.name), column.getSQLType()]
    if (column.primary) parts.push("PRIMARY KEY")
    if (column.notNull && !column.primary) parts.push("NOT NULL")
    return parts.join(" ")
  })
  return `CREATE TABLE IF NOT EXISTS ${quote_identifier(getTableName(schema))} (${definitions.join(", ")})`
}

/** 安全引用 SQLite 标识符。 */
function quote_identifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}
