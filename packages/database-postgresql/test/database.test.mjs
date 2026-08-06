/** PostgreSQL Database Adapter 生命周期与可选真实数据库契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "../bin/index.js"

test("PostgreSQL Database requires a non-empty URL", () => {
  assert.throws(() => new Database({ url: "" }), /url is required/iu)
  assert.throws(() => new Database({ url: "   " }), /url is required/iu)
})

test("PostgreSQL Database dispose is idempotent and closes the client", async () => {
  const database = new Database({ url: "postgres://127.0.0.1:1/downcity_test" })
  await database.dispose()
  await database.dispose()
  await assert.rejects(
    database.query({ sql: "SELECT 1", params: [] }),
    /closed/iu,
  )
})

const postgres_url = process.env.DOWNCITY_POSTGRES_URL

test("PostgreSQL Adapter supports table operations and rollback", {
  skip: !postgres_url,
}, async () => {
  const { text, pgTable } = await import("drizzle-orm/pg-core")
  const items = pgTable("downcity_adapter_items", {
    item_id: text("item_id").primaryKey(),
    value: text("value").notNull(),
  })
  const database = new Database({ url: postgres_url })
  try {
    await database.ensure_table(items)
    await database.table(items).delete()
    await database.transaction(async (transaction) => {
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
      await table.delete({ item_id: "item_1" })
    })
    assert.deepEqual(await database.table(items).select(), [])

    await assert.rejects(database.transaction(async (transaction) => {
      await transaction.table(items).insert({ item_id: "rollback", value: "x" })
      throw new Error("rollback")
    }), /rollback/)
    assert.deepEqual(await database.table(items).select({ item_id: "rollback" }), [])
  } finally {
    await database.dispose()
  }
})
