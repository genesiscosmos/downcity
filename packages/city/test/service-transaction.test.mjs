/** Federation Service 事务 Context 集成测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Federation, InstallableService } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session, create_test_federation } from "./admin-fixture.mjs"

const first_table = sqliteTable("test_service_transaction_first", {
  item_id: text("item_id").primaryKey(),
})
const second_table = sqliteTable("test_service_transaction_second", {
  item_id: text("item_id").primaryKey(),
})

class TransactionTestService extends InstallableService {
  id = "transaction-test"
  database_schemas = {
    sqlite: {
      tables: { first: first_table, second: second_table },
    },
  }

  install(context) {
    context.route({
      method: "POST",
      path: "/rollback",
      auth: ["admin"],
      handler: async () => {
        await context.transaction(async (transaction) => {
          await transaction.table("first").insert({ item_id: "first" })
          await transaction.table("second").insert({ item_id: "second" })
          throw new Error("rollback requested")
        })
        return Response.json({ ok: true })
      },
    })
    context.route({
      method: "POST",
      path: "/rollback-delayed",
      auth: ["admin"],
      handler: async () => {
        await context.transaction(async (transaction) => {
          await transaction.table("first").insert({ item_id: "transaction" })
          transaction_started.resolve()
          await transaction_release.promise
          throw new Error("rollback requested")
        })
        return Response.json({ ok: true })
      },
    })
  }
}

let transaction_started = Promise.withResolvers()
let transaction_release = Promise.withResolvers()

test("service transaction rolls back every table write", async () => {
  const db = createSqliteDb(":memory:")
  const federation = create_test_federation({ database: db })
  federation.use(new TransactionTestService())
  await federation.health()
  const session_token = await create_test_admin_session(federation)
  const response = await federation.fetch(new Request("http://localhost/v1/transaction-test/rollback", {
    method: "POST",
    headers: { authorization: `Bearer ${session_token}`, "content-type": "application/json" },
    body: "{}",
  }))
  assert.equal(response.status, 500)
  assert.deepEqual(await (await federation.table("transaction-test.first")).select(), [])
  assert.deepEqual(await (await federation.table("transaction-test.second")).select(), [])
})

test("ordinary table operations wait for an active SQLite transaction", async () => {
  transaction_started = Promise.withResolvers()
  transaction_release = Promise.withResolvers()
  const db = createSqliteDb(":memory:")
  const federation = create_test_federation({ database: db })
  federation.use(new TransactionTestService())
  await federation.health()
  const session_token = await create_test_admin_session(federation)

  const rollback_request = federation.fetch(new Request("http://localhost/v1/transaction-test/rollback-delayed", {
    method: "POST",
    headers: { authorization: `Bearer ${session_token}`, "content-type": "application/json" },
    body: "{}",
  }))
  await transaction_started.promise

  const ordinary_insert = (await federation.table("transaction-test.first")).insert({
    item_id: "ordinary",
  })
  const state_before_release = await Promise.race([
    ordinary_insert.then(() => "completed"),
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 20)),
  ])
  assert.equal(state_before_release, "waiting")

  transaction_release.resolve()
  assert.equal((await rollback_request).status, 500)
  await ordinary_insert
  assert.deepEqual(await (await federation.table("transaction-test.first")).select(), [
    { item_id: "ordinary" },
  ])
})
