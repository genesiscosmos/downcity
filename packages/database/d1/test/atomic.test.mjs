/** Cloudflare D1 Adapter 原子批处理与输入校验契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Miniflare } from "miniflare"
import { Database } from "../bin/index.js"

const d1_tests_enabled = process.env.DOWNCITY_RUN_D1_TESTS === "1"

test("D1 atomic 批量执行写入多条记录并返回 changes", {
  skip: !d1_tests_enabled,
}, async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  })
  try {
    const database = new Database({ binding: await miniflare.getD1Database("DB") })
    try {
      await database.execute_ddl(
        "CREATE TABLE atomic_items (item_id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      )
      assert.deepEqual(await database.atomic([
        { sql: "INSERT INTO atomic_items (item_id, value) VALUES (?, ?)", params: ["a", "first"] },
        { sql: "INSERT INTO atomic_items (item_id, value) VALUES (?, ?)", params: ["b", "second"] },
      ]), [{ changes: 1 }, { changes: 1 }])
      assert.deepEqual((await database.query({
        sql: "SELECT item_id, value FROM atomic_items ORDER BY item_id",
        params: [],
      })).rows, [
        { item_id: "a", value: "first" },
        { item_id: "b", value: "second" },
      ])
    } finally {
      await database.dispose()
    }
  } finally {
    await miniflare.dispose()
  }
})

test("D1 拒绝空 DDL、非数组 atomic 输入和空 SQL", {
  skip: !d1_tests_enabled,
}, async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  })
  try {
    const database = new Database({ binding: await miniflare.getD1Database("DB") })
    try {
      await assert.rejects(database.execute_ddl(""), /DDL statement is required/iu)
      await assert.rejects(database.atomic(null), /atomic statements must be an array/iu)
      await assert.rejects(database.query({ sql: " ", params: [] }), /SQL statement is required/iu)
    } finally {
      await database.dispose()
    }
  } finally {
    await miniflare.dispose()
  }
})
