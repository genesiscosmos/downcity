/** Cloudflare D1 Database Adapter 契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Miniflare } from "miniflare"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Database } from "../bin/index.js"

const items = sqliteTable("adapter_items", {
  item_id: text("item_id").primaryKey(),
  value: text("value").notNull(),
})

test("D1 transaction exposes buffered writes to later reads", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  })
  try {
    const binding = await miniflare.getD1Database("DB")
    const database = new Database({ binding })
    await database.ensure_table(items)

    await database.transaction(async (transaction) => {
      const table = transaction.table(items)
      await table.insert({ item_id: "item_1", value: "first" })
      assert.deepEqual(await table.select({ item_id: "item_1" }), [
        { item_id: "item_1", value: "first" },
      ])
      assert.equal(await table.update({
        where: { item_id: "item_1" },
        values: { value: "second" },
      }), 1)
      assert.equal((await table.select({ item_id: "item_1" }))[0].value, "second")
      assert.equal(await table.delete({ item_id: "item_1" }), 1)
      assert.deepEqual(await table.select({ item_id: "item_1" }), [])
      await table.insert_if_absent({ item_id: "item_2", value: "kept" })
      await table.insert_if_absent({ item_id: "item_2", value: "ignored" })
      assert.deepEqual(await table.select({ item_id: "item_2" }), [
        { item_id: "item_2", value: "kept" },
      ])
    })

    assert.deepEqual(await database.table(items).select(), [
      { item_id: "item_2", value: "kept" },
    ])
    await database.dispose()
    await assert.rejects(database.query({ sql: "SELECT 1", params: [] }), /closed/iu)
  } finally {
    await miniflare.dispose()
  }
})
