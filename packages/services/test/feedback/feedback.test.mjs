import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/city"
import { createSqliteDb } from "../usage/sqlite-db.mjs"
import { FeedbackService } from "../../bin/index.js"

test("feedbackService manages user feedback and admin replies", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-feedback-service-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = new Federation({ database: db })
    base.use(new FeedbackService())

    await base.health()
    const adminSecret = await readEnvValue(base, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")

    const servicesResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/services",
      method: "GET",
    }))
    assert.equal(servicesResponse.status, 200)
    const services = await servicesResponse.json()
    assert.ok(services.items.some((item) => item.id === "feedback"))

    const cityOne = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: {
        bureau_id: " legacy:city/id ",
        name: "City One",
        server_url: "https://city-one.example.com",
      },
    }))).json()
    assert.equal(cityOne.bureau_id, " legacy:city/id ")
    const cityTwo = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "City Two", server_url: "https://city-two.example.com" },
    }))).json()

    const userOneToken = await issue_user_token(base, cityOne.bureau_id, "user_1")
    const userTwoToken = await issue_user_token(base, cityOne.bureau_id, "user_2")
    const userOtherCityToken = await issue_user_token(base, cityTwo.bureau_id, "user_1")

    const emptyResponse = await base.fetch(userRequest({
      token: userOneToken,
      path: "/v1/feedback/send",
      body: { message: "   " },
    }))
    assert.equal(emptyResponse.status, 400)

    const createOneResponse = await base.fetch(userRequest({
      token: userOneToken,
      path: "/v1/feedback/send",
      body: {
        message: "Image jobs often stay queued",
        contact: "user@example.com",
        meta: { page: "/billing", client_version: "1.2.3" },
      },
    }))
    assert.equal(createOneResponse.status, 200)
    const createdOne = await createOneResponse.json()
    assert.match(createdOne.feedback_id, /^fb_/)
    assert.equal(createdOne.status, "open")
    assert.match(createdOne.created_at, /^\d{4}-\d{2}-\d{2}T/)

    const createTwoResponse = await base.fetch(userRequest({
      token: userTwoToken,
      path: "/v1/feedback/send",
      body: { message: "Please add invoices", contact: "" },
    }))
    assert.equal(createTwoResponse.status, 200)
    const createdTwo = await createTwoResponse.json()

    const createOtherCityResponse = await base.fetch(userRequest({
      token: userOtherCityToken,
      path: "/v1/feedback/send",
      body: { message: "City-specific issue" },
    }))
    assert.equal(createOtherCityResponse.status, 200)

    const meResponse = await base.fetch(userRequest({
      token: userOneToken,
      path: "/v1/feedback/me",
      method: "GET",
    }))
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.items.length, 1)
    assert.equal(me.items[0].feedback_id, createdOne.feedback_id)
    assert.equal(me.items[0].bureau_id, cityOne.bureau_id)
    assert.equal(me.items[0].user_id, "user_1")
    assert.equal(me.items[0].status, "open")
    assert.equal(me.items[0].reply, "")
    assert.equal(me.items[0].reply_by, "")
    assert.equal(me.items[0].replied_at, "")
    assert.equal(me.items[0].metadata_json, JSON.stringify({ page: "/billing", client_version: "1.2.3" }))

    const queryStatusResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/messages?status=open&bureau_id=" + encodeURIComponent(cityOne.bureau_id),
      method: "GET",
    }))
    assert.equal(queryStatusResponse.status, 200)
    const queryStatus = await queryStatusResponse.json()
    assert.equal(queryStatus.items.length, 2)
    assert.deepEqual(new Set(queryStatus.items.map((item) => item.feedback_id)), new Set([
      createdOne.feedback_id,
      createdTwo.feedback_id,
    ]))

    const queryUserResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/messages?user_id=user_1",
      method: "GET",
    }))
    assert.equal(queryUserResponse.status, 200)
    const queryUser = await queryUserResponse.json()
    assert.equal(queryUser.items.length, 2)
    assert.ok(queryUser.items.every((item) => item.user_id === "user_1"))

    const replyMissingResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/reply",
      body: { feedback_id: "fb_missing", reply: "not found" },
    }))
    assert.equal(replyMissingResponse.status, 404)

    const replyResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/reply",
      body: {
        feedback_id: createdOne.feedback_id,
        reply: "We fixed the async result parser.",
        reply_by: "support",
      },
    }))
    assert.equal(replyResponse.status, 200)
    const replied = await replyResponse.json()
    assert.equal(replied.feedback_id, createdOne.feedback_id)
    assert.equal(replied.status, "replied")
    assert.match(replied.replied_at, /^\d{4}-\d{2}-\d{2}T/)

    const statusResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/status",
      body: {
        feedback_id: createdOne.feedback_id,
        status: "closed",
      },
    }))
    assert.equal(statusResponse.status, 200)
    const closed = await statusResponse.json()
    assert.equal(closed.status, "closed")

    const afterReplyResponse = await base.fetch(userRequest({
      token: userOneToken,
      path: "/v1/feedback/me?status=closed",
      method: "GET",
    }))
    assert.equal(afterReplyResponse.status, 200)
    const afterReply = await afterReplyResponse.json()
    assert.equal(afterReply.items.length, 1)
    assert.equal(afterReply.items[0].reply, "We fixed the async result parser.")
    assert.equal(afterReply.items[0].reply_by, "support")
    assert.notEqual(afterReply.items[0].replied_at, "")
    assert.equal(afterReply.items[0].status, "closed")

    const invalidStatusResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/status",
      body: {
        feedback_id: createdOne.feedback_id,
        status: "invalid",
      },
    }))
    assert.equal(invalidStatusResponse.status, 400)

    const missingStatusResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/feedback/status",
      body: {
        feedback_id: "fb_missing",
        status: "closed",
      },
    }))
    assert.equal(missingStatusResponse.status, 404)

    const guestSendResponse = await base.fetch(new Request("http://localhost/v1/feedback/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "guest" }),
    }))
    assert.equal(guestSendResponse.status, 401)

    const guestAdminResponse = await base.fetch(new Request("http://localhost/v1/feedback/messages", {
      method: "GET",
    }))
    assert.equal(guestAdminResponse.status, 401)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

function adminRequest(adminSecret, { path: pathname, method = "POST", body }) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminSecret}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function userRequest({ token, path: pathname, method = "POST", body }) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function issue_user_token(base, bureau_id, user_id) {
  const token_body = await (await base.getAuthenticator()).createToken({
    bureau_id,
    user_id,
  })
  return token_body.user_token
}

async function readEnvValue(base, key) {
  const envTable = await base.table("env")
  const rows = await envTable.select({ key })
  return rows[0]?.value ?? ""
}
