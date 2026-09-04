/** Organizations Service 的 Cloudflare D1 原子事务集成测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Federation, InstallableService } from "@downcity/federation"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { OrganizationsService } from "../../bin/index.js"
import { create_test_admin_session } from "../admin-fixture.mjs"
import { create_d1_db } from "./d1-db.mjs"

const rollback_first = sqliteTable("service_d1_rollback_first", {
  item_id: text("item_id").primaryKey(),
})
const rollback_second = sqliteTable("service_d1_rollback_second", {
  item_id: text("item_id").primaryKey(),
})

class D1RollbackService extends InstallableService {
  id = "d1-rollback"
  database_schemas = {
    sqlite: { tables: { first: rollback_first, second: rollback_second } },
  }

  install(context) {
    context.route({
      method: "POST",
      path: "/run",
      auth: ["admin"],
      handler: async () => {
        await context.transaction(async (transaction) => {
          await transaction.table("first").insert({ item_id: "first" })
          await transaction.table("second").insert({ item_id: "second" })
          await transaction.table("first").insert({ item_id: "first" })
        })
        return Response.json({ ok: true })
      },
    })
  }
}

test("D1 transaction rolls back every buffered write when one statement fails", async () => {
  const runtime = await create_d1_db()
  try {
    const federation = new Federation({ database: runtime.database })
    federation.use(new D1RollbackService())
    await federation.health()
    const secret = await create_test_admin_session(federation)
    const response = await federation.fetch(admin_request(secret, "/v1/d1-rollback/run", {}))
    assert.equal(response.status, 500)
    assert.deepEqual(await (await federation.table("d1-rollback.first")).select(), [])
    assert.deepEqual(await (await federation.table("d1-rollback.second")).select(), [])
  } finally {
    await runtime.dispose()
  }
})

test("Organizations initializes on D1 and concurrent create cannot exceed owner quota", async () => {
  const runtime = await create_d1_db()
  try {
    const federation = new Federation({ database: runtime.database })
    federation.use(new OrganizationsService({ max_organizations_per_user: 1 }))
    await federation.health()
    const secret = await create_test_admin_session(federation)
    const bureau = await json_request(federation, admin_request(secret, "/v1/bureaus/create", {
      name: "D1 Bureau",
      server_url: "https://d1.example.com",
    }))
    const token = await issue_user_token(federation, secret, bureau.bureau_id, "d1_owner")
    const responses = await Promise.all([
      federation.fetch(user_request(token, "/v1/organizations/create", {
        name: "First",
        scope_type: "bureau",
      })),
      federation.fetch(user_request(token, "/v1/organizations/create", {
        name: "Second",
        scope_type: "federation",
      })),
    ])
    const response_bodies = await Promise.all(responses.map((response) => response.clone().text()))
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
      JSON.stringify(response_bodies),
    )
    const created = response_bodies.map((body) => JSON.parse(body)).find((body) => body.organization)
    assert.equal(created.organization.scope_bureau_id, bureau.bureau_id)
    const member_token = await issue_user_token(federation, secret, bureau.bureau_id, "d1_member")
    const pending = await json_request(federation, user_request(
      member_token,
      "/v1/organizations/join-requests/create",
      { organization_id: created.organization.organization_id },
    ))
    const decisions = await Promise.all([
      federation.fetch(user_request(token, "/v1/organizations/join-requests/decide", {
        request_id: pending.request_id,
        decision: "approved",
      })),
      federation.fetch(user_request(token, "/v1/organizations/join-requests/decide", {
        request_id: pending.request_id,
        decision: "approved",
      })),
    ])
    assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 404])
    const memberships = await (await federation.table("organizations.memberships")).select({
      organization_id: created.organization.organization_id,
      user_id: "d1_member",
      state: "active",
    })
    assert.equal(memberships.length, 1)
    const organizations = await json_request(
      federation,
      user_request(token, "/v1/organizations/my", undefined, "GET"),
    )
    assert.equal(organizations.items.filter((item) => item.state === "active").length, 1)
  } finally {
    await runtime.dispose()
  }
})

function user_request(token, pathname, body, method = "POST") {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function admin_request(secret, pathname, body) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function json_request(federation, request) {
  const response = await federation.fetch(request)
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body
}

async function issue_user_token(federation, secret, bureau_id, user_id) {
  void secret
  const result = await (await federation.getAuthenticator()).createToken({ bureau_id, user_id })
  return result.user_token
}
