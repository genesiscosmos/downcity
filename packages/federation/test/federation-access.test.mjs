/**
 * Federation 客户端行为测试。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { Federation } from "../bin/index.js"

test("Federation 只公开 user 和 admin 身份子域", () => {
  const federation = new Federation({
    url: "https://fed.example.com",
  })

  assert.ok(federation.user)
  assert.ok(federation.admin)
  assert.equal("bureau" in federation, false)
  assert.equal("city" in federation, false)
})

test("Federation account 查询状态不交付 Token，显式交换后更新当前 User Token", async () => {
  const requests = []
  const federation = new Federation({
    url: "https://fed.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({
        status: "done",
        login_id: "login_1",
        provider: "local",
        ...(url.endsWith("/login/start") ? { login_secret: "private_login_proof" } : {}),
        ...(url.endsWith("/login/exchange") ? { user_token: "user_token_1" } : {}),
      })
    },
  })

  const result = await federation.user.account.login_start({
    provider: "local",
    client_type: "cli",

  })

  assert.equal(result.status, "done")
  assert.equal(result.user_token, undefined)
  assert.equal(federation.user.account.token(), undefined)
  const status = await federation.user.account.status()
  assert.equal(status.status, "done")
  assert.equal(status.user_token, undefined)
  assert.equal(federation.user.account.token(), undefined)
  assert.equal(requests[1].url, "https://fed.example.com/v1/accounts/login/result")
  assert.equal(requests[1].init.method, "POST")
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    login_id: "login_1", login_secret: "private_login_proof",
  })
  await federation.user.account.exchange()
  assert.equal(federation.user.account.token(), "user_token_1")
  assert.equal(requests[2].url, "https://fed.example.com/v1/accounts/login/exchange")
  const exchange = JSON.parse(requests[2].init.body)
  assert.equal(exchange.login_id, "login_1")
  assert.equal(exchange.login_secret, "private_login_proof")
  assert.equal(typeof exchange.exchange_id, "string")
  assert.equal(requests[0].url, "https://fed.example.com/v1/accounts/login/start")
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    provider: "local",
    client_type: "cli",

  })
})

test("Federation OAuth 通过宿主回调交换 Token 后供 user current 使用，不轮询领取", async () => {
  const requests = []
  const federation = new Federation({
    url: "https://fed.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/login/start")) {
        return json({
          status: "redirect_required", url: "https://fed.example.com/v1/accounts/oauth/authorize?login_id=login_1",
          login_id: "login_1", login_secret: "private_login_proof",
        })
      }
      if (url.endsWith("/login/exchange")) {
        return json({ status: "done", login_id: "login_1", user_token: "user_token_1" })
      }
      return json({
        user: {
          user_id: "user_1",

        },
        profile: null,
      })
    },
  })

  await federation.user.account.login({
    provider: "google", client_type: "cli",
    redirect_uri: "http://127.0.0.1:45000/oauth/callback/test", state: "s".repeat(43),
    code_challenge: "c".repeat(43), code_challenge_method: "S256",
    on_authorize: async (url) => {
      assert.equal(url, "https://fed.example.com/v1/accounts/oauth/authorize?login_id=login_1")
      return { authorization_code: "browser_callback_code", code_verifier: "v".repeat(43) }
    },
  })
  const exchange_input = JSON.parse(requests[1].init.body)
  assert.equal(exchange_input.authorization_code, "browser_callback_code")
  assert.equal(exchange_input.code_verifier, "v".repeat(43))
  assert.equal(exchange_input.login_secret, "private_login_proof")
  assert.equal(requests.some((item) => item.url.endsWith("/login/result")), false)
  const current_user = await federation.user.current()

  assert.equal(current_user.user.user_id, "user_1")
  assert.equal(requests[1].url, "https://fed.example.com/v1/accounts/login/exchange")
  assert.equal(requests[2].url, "https://fed.example.com/v1/accounts/me")
  assert.equal(requests[2].init.headers.authorization, "Bearer user_token_1")
})

test("Federation admin 登录后立即提供管理能力", async () => {
  const requests = []
  const federation = new Federation({
    url: "https://fed.example.com",
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

  await federation.admin.login({
    admin_id: "owner",
    password: "secret",
  })
  assert.deepEqual(await federation.admin.list_services(), [])
  assert.equal(requests[1].url, "https://fed.example.com/v1/services")
  assert.equal(requests[1].init.headers.authorization, "Bearer admin_session_1")
})

test("Federation 业务只请求当前 origin，不发现或转发其他服务地址", async () => {
  const requests = []
  const federation = new Federation({
    url: "https://fed.example.com",
    user_token: "user_token_1",
    fetch: async (url) => { requests.push(url); return json({}) },
  })
  try {
    assert.equal("get" in federation.user, false)
    assert.equal("post" in federation.user, false)
    await federation.user.service("business").action("https://attacker.example.com/private").invoke()
    assert.equal(requests.length, 1)
    assert.equal(new URL(requests[0]).origin, "https://fed.example.com")
    assert.ok(requests.every((url) => !url.includes("/bureaus/current")))
  } finally { await federation.dispose() }
})

test("Federation 管理员入口不提供 identify", () => {
  const federation = new Federation({
    url: "https://fed.example.com",
    admin_token: "admin_session_1",
  })

  assert.equal("identify" in federation.admin, false)
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
