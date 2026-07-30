/** SQLite Database Adapter 契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Database } from "../bin/index.js"

const items = sqliteTable("adapter_items", {
  item_id: text("item_id").primaryKey(),
  value: text("value").notNull(),
})

test("SQLite transaction supports read-your-writes and rollback", async () => {
  const database = new Database({ filename: ":memory:" })
  await database.ensure_table(items)

  await assert.rejects(database.transaction(async (transaction) => {
    const table = transaction.table(items)
    await table.insert({ item_id: "item_1", value: "first" })
    assert.deepEqual(await table.select({ item_id: "item_1" }), [
      { item_id: "item_1", value: "first" },
    ])
    await table.update({
      where: { item_id: "item_1" },
      values: { value: "second" },
    })
    assert.equal((await table.select({ item_id: "item_1" }))[0].value, "second")
    throw new Error("rollback")
  }), /rollback/)

  assert.deepEqual(await database.table(items).select(), [])
  await database.dispose()
  await database.dispose()
  await assert.rejects(database.query({ sql: "SELECT 1", params: [] }), /closed/iu)
})
