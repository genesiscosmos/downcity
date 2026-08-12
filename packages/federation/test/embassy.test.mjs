/**
 * Embassy 客户端行为测试。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { Embassy } from "../bin/index.js"

test("Embassy 只公开 user 和 admin 身份子域", () => {
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
  })

  assert.ok(embassy.user)
  assert.ok(embassy.admin)
  assert.equal("bureau" in embassy, false)
  assert.equal("city" in embassy, false)
})

test("Embassy account 登录成功后更新当前 User Token", async () => {
  const requests = []
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({
        status: "done",
        login_id: "login_1",
        provider: "local",
        user_token: "user_token_1",
        user_id: "user_1",
      })
    },
  })

  const result = await embassy.user.account.login_start({
    provider: "local",
    bureau_id: "bureau_product",
  })

  assert.equal(result.status, "done")
  assert.equal(embassy.user.account.token(), "user_token_1")
  assert.equal(requests[0].url, "https://fed.example.com/v1/accounts/login/start")
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    provider: "local",
    bureau_id: "bureau_product",
  })
})

test("Embassy user current 使用登录后写入的 User Token", async () => {
  const requests = []
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/login/start")) {
        return json({
          status: "done",
          login_id: "login_1",
          user_token: "user_token_1",
          user_id: "user_1",
        })
      }
      return json({
        user: {
          user_id: "user_1",
          bureau_id: "bureau_product",
        },
        profile: null,
      })
    },
  })

  await embassy.user.account.login_start({
    provider: "local",
    bureau_id: "bureau_product",
  })
  const current_user = await embassy.user.current()

  assert.equal(current_user.user.user_id, "user_1")
  assert.equal(requests[1].url, "https://fed.example.com/v1/accounts/me")
  assert.equal(requests[1].init.headers.authorization, "Bearer user_token_1")
})

test("Embassy admin 登录后立即提供管理能力", async () => {
  const requests = []
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/v1/admin/login")) {
        return json({
          admin_id: "owner",
          session_token: "admin_session_1",
          expires_at: "2027-01-01T00:00:00.000Z",
        })
      }
      return json({ items: [] })
    },
  })

  await embassy.admin.login({
    admin_id: "owner",
    password: "secret",
  })
  assert.deepEqual(await embassy.admin.list_services(), [])
  assert.equal(requests[1].url, "https://fed.example.com/v1/services")
  assert.equal(requests[1].init.headers.authorization, "Bearer admin_session_1")
})

test("Embassy 拒绝把 User Token 转发到其他 origin", async () => {
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
    user_token: "user_token_1",
    fetch: async (url) => {
      if (url.endsWith("/v1/bureaus/current")) {
        return json({
          bureau: {
            bureau_id: "bureau_product",
            name: "Product",
            server: {
              bureau_id: "bureau_product",
              server_url: "https://product.example.com",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            state: "active",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            archived_at: "",
          },
        })
      }
      return json({})
    },
  })

  await assert.rejects(
    embassy.user.get("https://attacker.example.com/private"),
    /current Bureau server origin/,
  )
})

test("Embassy 不接收 Bureau Token，也不提供 identify", () => {
  const embassy = new Embassy({
    federation_url: "https://fed.example.com",
    admin_token: "admin_session_1",
  })

  assert.equal("identify" in embassy.admin, false)
})

function json(body, status = 200) {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
    async json() { return body },
    async text() { return text },
  }
}
