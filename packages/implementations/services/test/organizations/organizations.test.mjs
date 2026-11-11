/** Organizations Service 端到端行为测试。 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/federation"
import { createSqliteDb } from "../usage/sqlite-db.mjs"
import { OrganizationsService } from "../../bin/index.js"
import { create_test_admin_session } from "../admin-fixture.mjs"

test("organizations service manages membership, governance and federation owner quota", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-organizations-"))
  try {
    const federation = new Federation({ database: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    federation.use(new OrganizationsService({ max_organizations_per_user: 1 }))
    await federation.health()
    const admin_secret = await create_test_admin_session(federation)
    const owner_token = await issue_user_token(federation, admin_secret, "owner_1")
    const member_token = await issue_user_token(federation, admin_secret, "member_1")
    const other_token = await issue_user_token(federation, admin_secret, "other_1")

    const created = await json_request(federation, user_request(owner_token, "/v1/organizations/create", {
      name: "Research Team",
      join_policy: "approval",
    }))
    assert.match(created.organization.organization_id, /^org_[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.match(created.membership.membership_id, /^mem_[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.equal(created.membership.role, "owner")
    assert.equal(created.organization.join_policy, "approval")
    assert.equal("server_url" in created.organization, false)

    const quota_response = await federation.fetch(user_request(owner_token, "/v1/organizations/create", {
      name: "Second",
      join_policy: "approval",
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

    const removed = await json_request(federation, user_request(owner_token, "/v1/organizations/members/remove", {
      organization_id,
      membership_id: first_membership_id,
    }))
    assert.equal(removed.state, "removed")

    const removed_membership_response = await federation.fetch(user_request(
      member_token,
      `/v1/organizations/membership/get?organization_id=${organization_id}`,
      undefined,
      "GET",
    ))
    assert.equal(removed_membership_response.status, 403)

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
    for (const action of ["server/update", "token/create", "events/deliver"]) {
      const deleted_action = await federation.fetch(user_request(owner_token, `/v1/organizations/${action}`, {
        organization_id,
      }))
      assert.equal(deleted_action.status, 404)
    }

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
    const archived_update_response = await federation.fetch(user_request(member_token, "/v1/organizations/update", {
      organization_id,
      name: "Archived Team",
    }))
    assert.equal(archived_update_response.status, 410)

    const owner_can_create_again = await json_request(federation, user_request(member_token, "/v1/organizations/create", {
      name: "Next Organization",
      join_policy: "approval",
    }))
    assert.equal(owner_can_create_again.membership.role, "owner")
    assert.equal(owner_can_create_again.organization.join_policy, "approval")

    const my = await json_request(federation, user_request(member_token, "/v1/organizations/my", undefined, "GET"))
    assert.equal(my.items.length, 1)
    assert.ok(my.items.every((item) => item.state === "active"))
    const with_archived = await json_request(
      federation,
      user_request(member_token, "/v1/organizations/my?include_archived=true", undefined, "GET"),
    )
    assert.equal(with_archived.items.length, 2)
    assert.ok(with_archived.items.some((item) => item.organization_id === organization_id && item.state === "archived"))
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("concurrent organization creation cannot exceed the owner quota", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-organizations-quota-"))
  try {
    const federation = new Federation({ database: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    federation.use(new OrganizationsService({ max_organizations_per_user: 1 }))
    await federation.health()
    const admin_secret = await create_test_admin_session(federation)
    const owner_token = await issue_user_token(federation, admin_secret, "owner_concurrent")

    const responses = await Promise.all([
      federation.fetch(user_request(owner_token, "/v1/organizations/create", {
        name: "First",
        join_policy: "approval",
      })),
      federation.fetch(user_request(owner_token, "/v1/organizations/create", {
        name: "Second",
        join_policy: "approval",
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

test("私有组织默认关闭申请，只有 owner/admin 可开放；City 来源不能绕过成员检查", async () => {
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  federation.use(new OrganizationsService({ max_organizations_per_user: 2 }))
  try {
    await federation.ready()
    const owner = await issue_user_token(federation, "", "owner")
    const other = await issue_user_token(federation, "", "other")
    const created = await json_request(federation, user_request(owner, "/v1/organizations/create", { name: "Private" }))
    const organization_id = created.organization.organization_id
    assert.equal(created.organization.join_policy, "closed")
    const send = async (token, action, body, method = "POST") => {
      const request = user_request(token, `/v1/organizations/${action}`, body, method)
      request.headers.set("x-downcity-city-id", "city_shared")
      return federation.fetch(request)
    }
    assert.equal((await send(other, "join-requests/create", { organization_id })).status, 403)
    assert.equal((await send(other, "update", { organization_id, join_policy: "approval" })).status, 403)
    assert.equal((await send(other, `get?organization_id=${organization_id}`, undefined, "GET")).status, 403)
    assert.equal((await send(other, `members/list?organization_id=${organization_id}`, undefined, "GET")).status, 403)
    await json_request(federation, user_request(owner, "/v1/organizations/update", { organization_id, join_policy: "approval" }))
    const pending = await json_request(federation, user_request(other, "/v1/organizations/join-requests/create", { organization_id }))
    assert.equal(pending.state, "pending")
    await json_request(federation, user_request(owner, "/v1/organizations/update", { organization_id, join_policy: "closed" }))
    assert.equal((await send(other, "join-requests/cancel", { request_id: pending.request_id })).status, 200)
  } finally { await federation.dispose() }
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

async function issue_user_token(federation, secret, user_id) {
  void secret
  const body = await (await federation.runtime.get_authenticator()).createToken({ user_id })
  return body.user_token
}
