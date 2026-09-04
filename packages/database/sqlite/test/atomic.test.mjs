/** SQLite Adapter 原子批处理与 Service 数据库投影契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "../bin/index.js"

test("SQLite atomic 批量执行返回每条 mutation 结果并保持参数隔离", async () => {
  const database = new Database({ filename: ":memory:" })
  try {
    await database.execute_ddl(
      "CREATE TABLE atomic_items (item_id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    const statements = [
      { sql: "INSERT INTO atomic_items (item_id, value) VALUES (?, ?)", params: ["a", "first"] },
      { sql: "INSERT INTO atomic_items (item_id, value) VALUES (?, ?)", params: ["b", "second"] },
    ]
    const results = await database.atomic(statements)
    assert.deepEqual(results, [{ changes: 1 }, { changes: 1 }])
    assert.deepEqual(statements[0].params, ["a", "first"])
    assert.deepEqual(
      (await database.query({
        sql: "SELECT item_id, value FROM atomic_items ORDER BY item_id",
        params: [],
      })).rows,
      [
        { item_id: "a", value: "first" },
        { item_id: "b", value: "second" },
      ],
    )
  } finally {
    await database.dispose()
  }
})

test("SQLite service_context 暴露最小 schema/query/atomic 能力", async () => {
  const database = new Database({ filename: ":memory:" })
  try {
    const context = database.service_context()
    assert.equal(context.schema_id, "sqlite")
    assert.equal(Object.isFrozen(context), true)
    await context.query({ sql: "SELECT 1 AS value", params: [] })
    assert.deepEqual(await context.atomic([]), [])
  } finally {
    await database.dispose()
  }
})
