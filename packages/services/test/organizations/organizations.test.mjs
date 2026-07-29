/** Organizations Service 端到端行为测试。 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/city"
import { createSqliteDb } from "../usage/sqlite-db.mjs"
import { OrganizationsService } from "../../bin/index.js"

test("organizations service manages membership, tokens, revocation and owner quota", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-organizations-"))
  const deliveries = []
  let delivery_available = false
  try {
    const federation = new Federation({ db: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    federation.use(new OrganizationsService({
      max_organizations_per_user: 1,
      fetch: async (url, init) => {
        deliveries.push({ url: String(url), body: JSON.parse(String(init.body)) })
        return new Response(null, { status: delivery_available ? 204 : 503 })
      },
    }))
    await federation.health()
    const admin_secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const city = await json_request(federation, admin_request(admin_secret, "/v1/cities/create", {
      name: "Vibecape",
    }))
    const owner_token = await issue_user_token(federation, admin_secret, city.city_id, "owner_1")
    const member_token = await issue_user_token(federation, admin_secret, city.city_id, "member_1")
    const other_token = await issue_user_token(federation, admin_secret, city.city_id, "other_1")

    const created = await json_request(federation, user_request(owner_token, "/v1/organizations/create", {
      name: "Research Team",
      server_url: "https://spaces.example.com/",
    }))
    assert.match(created.organization.organization_id, /^org_[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.match(created.membership.membership_id, /^mem_[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.equal(created.membership.role, "owner")
    assert.equal(created.organization.server_url, "https://spaces.example.com")

    const quota_response = await federation.fetch(user_request(owner_token, "/v1/organizations/create", {
      name: "Second",
      server_url: "https://second.example.com",
    }))
    assert.equal(quota_response.status, 409)

    const organization_id = created.organization.organization_id
    const pending = await json_request(federation, user_request(member_token, "/v1/organizations/join-requests/create", {
      organization_id,
    }))
    assert.equal(pending.state, "pending")

    const duplicate = await json_request(federation, user_request(member_token, "/v1/organizations/join-requests/create", {
      organization_id,
    }))
    assert.equal(duplicate.request_id, pending.request_id)

    const approved = await json_request(federation, user_request(owner_token, "/v1/organizations/join-requests/decide", {
      request_id: pending.request_id,
      decision: "approved",
    }))
    const first_membership_id = approved.membership.membership_id
    assert.equal(approved.membership.role, "member")

    const issued = await json_request(federation, user_request(member_token, "/v1/organizations/token/create", {
      organization_id,
    }))
    assert.match(issued.organization_token, /^ot_/)
    const organization_claims = decode_jwt(issued.organization_token.slice(3))
    assert.equal(organization_claims.aud, "https://spaces.example.com")
    assert.equal(organization_claims.organization_id, organization_id)
    assert.equal(organization_claims.membership_id, first_membership_id)
    assert.equal(organization_claims.exp - organization_claims.iat, 7 * 24 * 60 * 60)

    const removed = await json_request(federation, user_request(owner_token, "/v1/organizations/members/remove", {
      organization_id,
      membership_id: first_membership_id,
    }))
    assert.equal(removed.state, "removed")
    assert.equal(deliveries.length, 1)
    const removal_event = decode_jwt(deliveries[0].body.event_token.slice(3))
    assert.equal(removal_event.event_type, "organization.membership.removed")
    assert.equal(removal_event.membership_id, first_membership_id)

    const removed_token_response = await federation.fetch(user_request(member_token, "/v1/organizations/token/create", {
      organization_id,
    }))
    assert.equal(removed_token_response.status, 403)

    const second_pending = await json_request(federation, user_request(member_token, "/v1/organizations/join-requests/create", {
      organization_id,
    }))
    const second_approved = await json_request(federation, user_request(owner_token, "/v1/organizations/join-requests/decide", {
      request_id: second_pending.request_id,
      decision: "approved",
    }))
    assert.notEqual(second_approved.membership.membership_id, first_membership_id)

    const other_pending = await json_request(federation, user_request(other_token, "/v1/organizations/join-requests/create", {
      organization_id,
    }))
    const canceled = await json_request(federation, user_request(other_token, "/v1/organizations/join-requests/cancel", {
      request_id: other_pending.request_id,
    }))
    assert.equal(canceled.state, "canceled")

    await json_request(federation, user_request(owner_token, "/v1/organizations/members/role", {
      organization_id,
      membership_id: second_approved.membership.membership_id,
      role: "admin",
    }))
    const admin_server_update = await federation.fetch(user_request(member_token, "/v1/organizations/server/update", {
      organization_id,
      server_url: "https://denied.example.com",
    }))
    assert.equal(admin_server_update.status, 403)

    delivery_available = true
    const updated_server = await json_request(federation, user_request(owner_token, "/v1/organizations/server/update", {
      organization_id,
      server_url: "https://new-spaces.example.com",
    }))
    assert.equal(updated_server.server_url, "https://new-spaces.example.com")
    assert.ok(deliveries.some((item) => item.url === "https://spaces.example.com/v1/downcity/organization-events"))

    const transferred = await json_request(federation, user_request(owner_token, "/v1/organizations/owner/transfer", {
      organization_id,
      membership_id: second_approved.membership.membership_id,
    }))
    assert.equal(transferred.previous_owner.role, "admin")
    assert.equal(transferred.owner.role, "owner")

    const archived = await json_request(federation, user_request(member_token, "/v1/organizations/archive", {
      organization_id,
    }))
    assert.equal(archived.state, "archived")
    const archived_token_response = await federation.fetch(user_request(member_token, "/v1/organizations/token/create", {
      organization_id,
    }))
    assert.equal(archived_token_response.status, 410)

    const owner_can_create_again = await json_request(federation, user_request(member_token, "/v1/organizations/create", {
      name: "Next Organization",
      server_url: "https://next.example.com",
    }))
    assert.equal(owner_can_create_again.membership.role, "owner")

    const my = await json_request(federation, user_request(member_token, "/v1/organizations/my", undefined, "GET"))
    assert.equal(my.items.length, 2)
    assert.ok(my.items.some((item) => item.organization_id === organization_id && item.state === "archived"))
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("concurrent organization creation cannot exceed the owner quota", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-organizations-quota-"))
  try {
    const federation = new Federation({ db: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    federation.use(new OrganizationsService({ max_organizations_per_user: 1 }))
    await federation.health()
    const admin_secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const city = await json_request(federation, admin_request(admin_secret, "/v1/cities/create", {
      name: "Concurrent City",
    }))
    const owner_token = await issue_user_token(federation, admin_secret, city.city_id, "owner_concurrent")

    const responses = await Promise.all([
      federation.fetch(user_request(owner_token, "/v1/organizations/create", {
        name: "First",
        server_url: "https://first.example.com",
      })),
      federation.fetch(user_request(owner_token, "/v1/organizations/create", {
        name: "Second",
        server_url: "https://second.example.com",
      })),
    ])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])

    const my = await json_request(
      federation,
      user_request(owner_token, "/v1/organizations/my", undefined, "GET"),
    )
    assert.equal(my.items.filter((item) => item.state === "active").length, 1)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
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
  const body = await json_request(federation, admin_request(secret, "/v1/cities/tokens/apply", { city_id, user_id }))
  return body.user_token
}

async function read_env_value(federation, key) {
  const table = await federation.table("env")
  return (await table.select({ key }))[0]?.value ?? ""
}

function decode_jwt(jwt) {
  const payload = jwt.split(".")[1]
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
}
