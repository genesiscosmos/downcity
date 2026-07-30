/** Organizations Service 的 Cloudflare D1 原子事务集成测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { Federation, InstallableService } from "@downcity/city"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { OrganizationsService } from "../../bin/index.js"
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
    const secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
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
    const secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const city = await json_request(federation, admin_request(secret, "/v1/cities/create", {
      name: "D1 City",
    }))
    const token = await issue_user_token(federation, secret, city.city_id, "d1_owner")
    const responses = await Promise.all([
      federation.fetch(user_request(token, "/v1/organizations/create", {
        name: "First",
        server_url: "https://first.example.com",
      })),
      federation.fetch(user_request(token, "/v1/organizations/create", {
        name: "Second",
        server_url: "https://second.example.com",
      })),
    ])
    const response_bodies = await Promise.all(responses.map((response) => response.clone().text()))
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
      JSON.stringify(response_bodies),
    )
    const created = response_bodies.map((body) => JSON.parse(body)).find((body) => body.organization)
    const member_token = await issue_user_token(federation, secret, city.city_id, "d1_member")
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

async function issue_user_token(federation, secret, city_id, user_id) {
  const result = await json_request(
    federation,
    admin_request(secret, "/v1/cities/tokens/apply", { city_id, user_id }),
  )
  return result.user_token
}

async function read_env_value(federation, key) {
  return (await (await federation.table("env")).select({ key }))[0]?.value ?? ""
}
