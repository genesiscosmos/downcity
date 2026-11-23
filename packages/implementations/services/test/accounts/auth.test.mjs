/** Accounts 集成用例验证邮箱认证，以及 OAuth 产品回调、PKCE 和有界单次交换。 */
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EnvService, Downtown } from "@downcity/downtown"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session } from "../admin-fixture.mjs"
import {
  AccountsService,
  emailAccountsProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  wechatAccountsProvider,
} from "../../bin/index.js"

test("accountsService registers users, logs in, and issues Federation tokens", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))

  try {
    process.chdir(tempDir)
    const { base, adminSecret, verification_emails } = await setupBase(tempDir)


    const registerResponse = await base.fetch(jsonRequest("/v1/accounts/register", {
      email: "USER@example.com",
      password: "password123",
    }))
    assert.equal(registerResponse.status, 200)
    const registered = await registerResponse.json()
    assert.equal(registered.success, true)
    assert.equal(typeof registered.user_id, "string")

    assert.equal(registered.verification_token, undefined)
    assert.equal(verification_emails.length, 1)
    const verification_url = new URL(verification_emails[0].text.replace(/^Verification: /, ""))
    const unverified_start = await (await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "email", client_type: "cli",
    }))).json()
    const unverified_login = await base.fetch(jsonRequest("/v1/accounts/login/continue", {
      login_id: unverified_start.login_id,
      login_secret: unverified_start.login_secret,
      input: { email: "user@example.com", password: "password123" },
    }))
    assert.equal(unverified_login.status, 401)
    assert.equal((await unverified_login.json()).user_token, undefined)
    const verify_response = await base.fetch(jsonRequest("/v1/accounts/verify-email", {
      token: verification_url.searchParams.get("token"),
    }))
    assert.equal(verify_response.status, 200)
    const verified = await verify_response.json()
    assert.equal(verified.success, true)
    assert.equal(verified.user_token, undefined)

    const authStartResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "email",
      client_type: "cli",
    }))
    assert.equal(authStartResponse.status, 200)
    const authStarted = await authStartResponse.json()
    assert.equal(authStarted.status, "input_required")
    assert.equal(authStarted.provider, "email")
    assert.equal(typeof authStarted.login_id, "string")
    assert.equal(authStarted.inputs.length, 2)

    const authContinueResponse = await base.fetch(jsonRequest("/v1/accounts/login/continue", {
      login_id: authStarted.login_id,
      login_secret: authStarted.login_secret,
      input: {
        email: "user@example.com",
        password: "password123",
      },
    }))
    assert.equal(authContinueResponse.status, 200)
    const authContinued = await authContinueResponse.json()
    assert.equal(authContinued.status, "done")
    assert.equal(authContinued.login_id, authStarted.login_id)

    const authResult = await exchange_completed_login(base, authStarted)
    assert.equal(authResult.provider, "email")

    const meResponse = await base.fetch(new Request("http://localhost/v1/accounts/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${authResult.user_token}`,
      },
    }))
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.user.user_id, registered.user_id)
    assert.equal("bureau_id" in me.user, false)
    const logout = await base.fetch(new Request("http://localhost/v1/accounts/logout", {
      method: "POST", headers: { authorization: `Bearer ${authResult.user_token}` }, body: "{}",
    }))
    assert.equal(logout.status, 200)
    const revoked = await base.fetch(new Request("http://localhost/v1/federation/token", {
      headers: { authorization: `Bearer ${authResult.user_token}` },
    }))
    assert.equal(revoked.status, 401)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService reports enabled providers from server state", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))

  try {
    process.chdir(tempDir)
    const { base } = await setupBase(tempDir, {
      GITHUB_CLIENT_ID: "github_client_id",
      GITHUB_CLIENT_SECRET: "github_client_secret",
      WECHAT_CLIENT_ID: "wechat_client_id",
      WECHAT_CLIENT_SECRET: "wechat_client_secret",
    })

    const response = await base.fetch(new Request("http://localhost/v1/accounts/providers"))
    assert.equal(response.status, 200)

    const body = await response.json()
    assert.deepEqual(body.items, [
      {
        id: "email",
        type: "input",
        enabled: true,
        label: "Email",
        inputs: [
          {
            name: "email",
            type: "text",
            label: "Email",
            required: true,
          },
          {
            name: "password",
            type: "password",
            label: "Password",
            required: true,
          },
        ],
        login_enabled: true,
        register_enabled: true,
      },
      {
        id: "github",
        type: "oauth",
        enabled: true,
        label: "GitHub",
        inputs: [],
      },
      {
        id: "wechat",
        type: "oauth",
        enabled: true,
        label: "WeChat",
        inputs: [],
      },
    ])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService exposes local login when enabled", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-http-local-"))

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir, {}, { local_login: true })


    const localProvidersResponse = await base.fetch(new Request("http://localhost/v1/accounts/providers"))
    assert.equal(localProvidersResponse.status, 200)
    assert.deepEqual(await localProvidersResponse.json(), {
      items: [
        {
          id: "local",
          type: "input",
          enabled: true,
          label: "Local Account",
          inputs: [],
          login_enabled: true,
        },
      ],
    })

    const authStartResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "local",
      client_type: "cli",
    }))
    assert.equal(authStartResponse.status, 200)
    const authStarted = await authStartResponse.json()
    assert.equal(authStarted.status, "done")
    assert.equal(authStarted.provider, "local")
    assert.equal(typeof authStarted.login_id, "string")

    const authResult = await exchange_completed_login(base, authStarted)
    assert.equal(authResult.provider, "local")

    const meResponse = await base.fetch(new Request("http://localhost/v1/accounts/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${authResult.user_token}`,
      },
    }))
    assert.equal(meResponse.status, 200)
    assert.equal((await meResponse.json()).user.user_id, "local-user")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService rejects native session passthrough outside its allowlist", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-auth-route-"))

  try {
    process.chdir(tempDir)
    const { base } = await setupBase(tempDir)

    const response = await base.fetch(new Request("http://localhost/v1/accounts/auth/session", {
      method: "GET",
      headers: {
        "x-demo": "kept",
      },
    }))
    const body = await response.text()

    assert.equal(response.status, 404)
    assert.equal(body, "Not found")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService does not expose email login without an email provider", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-no-email-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = new Downtown({ database: db })
  base.use(new EnvService())
    base.use(new AccountsService({ token_ttl: "7d" }))
    await base.health()

    const admin_secret = await create_test_admin_session(base)

    const providersResponse = await base.fetch(new Request("http://localhost/v1/accounts/providers"))
    assert.equal(providersResponse.status, 200)
    assert.deepEqual(await providersResponse.json(), { items: [] })

    const loginResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "email",
      client_type: "cli",
    }))
    assert.equal(loginResponse.status, 400)
    const login_error = await loginResponse.json()
    assert.equal(login_error.error.message, "login provider is not enabled")
    assert.equal(typeof login_error.error.type, "string")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

for (const client_type of ["desktop", "cli", "web"]) test(`accountsService delivers ${client_type} Google OAuth through callback code and S256 PKCE`, async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))
  const originalFetch = globalThis.fetch

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir, {
      GOOGLE_CLIENT_ID: "google_client_id",
      GOOGLE_CLIENT_SECRET: "google_client_secret",
    })


    const code_verifier = randomBytes(32).toString("base64url")
    const callback_state = randomBytes(32).toString("base64url")
    const redirect_uri = client_type === "web" ? "https://product.example.com/api/auth/callback" : "http://127.0.0.1:43123/oauth/callback/test"
    const callback_input = { redirect_uri, state: callback_state,
      code_challenge: createHash("sha256").update(code_verifier).digest("base64url"), code_challenge_method: "S256" }
    for (const invalid_uri of ["https://attacker.example/api/auth/callback", "https://product.example.com/wrong", "http://localhost:43123/oauth/callback/test", `${redirect_uri}?extra=1`, `${redirect_uri}#fragment`]) {
      assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/start", {
        provider: "google", client_type, ...callback_input, redirect_uri: invalid_uri,
      }))).status, 400)
    }
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "google", client_type: "device", ...callback_input,
    }))).status, 400)
    const startResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "google",
      client_type,
      ...callback_input,
    }))
    assert.equal(startResponse.status, 200)
    const start = await startResponse.json()
    assert.equal(start.status, "redirect_required")
    assert.equal(typeof start.login_id, "string")
    assert.equal(start.state, undefined)
    assert.equal(typeof start.login_secret, "string")
    assert.equal(start.provider, "google")
    assert.equal(start.user_code, undefined)
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/oauth/confirm", {}))).status, 404)
    const landing = await base.fetch(new Request(start.url))
    assert.equal(landing.status, 303)
    const provider_url = landing.headers.get("location")
    assert.match(provider_url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    const authorization = { state: new URL(provider_url).searchParams.get("state"), cookie: landing.headers.get("set-cookie")?.split(";")[0] }

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url

      if (url === "https://oauth2.googleapis.com/token") {
        assert.equal(init?.method, "POST")
        const params = new URLSearchParams(String(init?.body))
        assert.equal(params.get("client_id"), "google_client_id")
        assert.equal(params.get("client_secret"), "google_client_secret")
        assert.equal(params.get("code"), "test-google-code")
        return Response.json({ access_token: "google_access_token" })
      }

      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        assert.equal(readHeader(init?.headers, "authorization"), "Bearer google_access_token")
        return Response.json({
          sub: "google-user-123",
          email: "google-user@example.com",
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }

    const callback_url = `http://localhost/v1/accounts/oauth/callback?state=${authorization.state}&code=test-google-code`
    assert.equal((await base.fetch(new Request(callback_url))).status, 400)
    assert.equal((await base.fetch(new Request(`${callback_url}&state=${authorization.state}`, { headers: { cookie: authorization.cookie } }))).status, 400)
    const callback = await base.fetch(new Request(callback_url, { headers: { cookie: authorization.cookie } }))
    assert.equal(callback.status, 303)
    const delivered = new URL(callback.headers.get("location"))
    assert.equal(delivered.origin + delivered.pathname, redirect_uri)
    assert.equal(delivered.searchParams.get("state"), callback_state)
    assert.ok(delivered.searchParams.get("code"))
    const proof = { login_id: start.login_id, login_secret: start.login_secret, exchange_id: crypto.randomUUID() }
    const pending = await (await base.fetch(jsonRequest("/v1/accounts/login/result", proof))).json()
    assert.equal(pending.status, "pending")
    assert.equal(pending.user_token, undefined)
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/exchange", proof))).status, 403)
    const exchange_input = { ...proof, authorization_code: delivered.searchParams.get("code"), code_verifier }
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/exchange", { ...exchange_input, code_verifier: "x".repeat(43) }))).status, 403)
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/exchange", { ...exchange_input, exchange_id: "invalid" }))).status, 400)
    const exchanged = await base.fetch(jsonRequest("/v1/accounts/login/exchange", exchange_input))
    assert.equal(exchanged.status, 200)
    const loginResult = await exchanged.json()
    const retry = await base.fetch(jsonRequest("/v1/accounts/login/exchange", exchange_input))
    assert.equal(retry.status, 200)
    assert.equal((await retry.json()).user_token, loginResult.user_token)
    assert.equal((await base.fetch(jsonRequest("/v1/accounts/login/exchange", { ...exchange_input, exchange_id: crypto.randomUUID() }))).status, 409)
    assert.equal((await base.fetch(new Request(callback_url, { headers: { cookie: authorization.cookie } }))).status, 400)
    assert.equal(loginResult.provider, "google")

    const meResponse = await base.fetch(new Request("http://localhost/v1/accounts/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${loginResult.user_token}`,
      },
    }))
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.profile.email, "google-user@example.com")
    assert.equal(me.profile.display_name, "google-user")
  } finally {
    globalThis.fetch = originalFetch
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService automatically returns WeChat OAuth to CLI and requires callback proof for exchange", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))
  const originalFetch = globalThis.fetch

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir, {
      WECHAT_CLIENT_ID: "wechat_client_id",
      WECHAT_CLIENT_SECRET: "wechat_client_secret",
    })


    const code_verifier = randomBytes(32).toString("base64url")
    const state = randomBytes(32).toString("base64url")
    const redirect_uri = "http://127.0.0.1:43123/oauth/callback/wechat"
    const startResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "wechat", client_type: "cli",
      redirect_uri, state, code_challenge: createHash("sha256").update(code_verifier).digest("base64url"), code_challenge_method: "S256",
    }))
    assert.equal(startResponse.status, 200)
    const start = await startResponse.json()
    assert.equal(start.status, "redirect_required")
    assert.equal(typeof start.login_id, "string")
    assert.equal(start.state, undefined)
    assert.equal(typeof start.login_secret, "string")
    assert.equal(start.provider, "wechat")
    const authorization = await begin_oauth_authorization(base, start)
    assert.match(authorization.provider_url, /^https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect\?/)
    assert.match(authorization.provider_url, /scope=snsapi_login/)

    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url

      if (url.startsWith("https://api.weixin.qq.com/sns/oauth2/access_token?")) {
        const params = new URL(url).searchParams
        assert.equal(params.get("appid"), "wechat_client_id")
        assert.equal(params.get("secret"), "wechat_client_secret")
        assert.equal(params.get("code"), "test-wechat-code")
        assert.equal(params.get("grant_type"), "authorization_code")
        return Response.json({
          access_token: "wechat_access_token",
          refresh_token: "wechat_refresh_token",
          expires_in: 7200,
          openid: "wechat-open-id-123",
          scope: "snsapi_login",
          unionid: "wechat-union-id-123",
        })
      }

      if (url.startsWith("https://api.weixin.qq.com/sns/userinfo?")) {
        const params = new URL(url).searchParams
        assert.equal(params.get("access_token"), "wechat_access_token")
        assert.equal(params.get("openid"), "wechat-open-id-123")
        return Response.json({
          openid: "wechat-open-id-123",
          unionid: "wechat-union-id-123",
          nickname: "wechat-user",
          headimgurl: "https://example.com/wechat-avatar.png",
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }

    const callback = await base.fetch(new Request(`http://localhost/v1/accounts/oauth/callback?state=${authorization.state}&code=test-wechat-code`, { headers: { cookie: authorization.cookie } }))
    assert.equal(callback.status, 303)
    const delivered = new URL(callback.headers.get("location"))
    assert.equal(delivered.origin + delivered.pathname, redirect_uri)
    assert.equal(delivered.searchParams.get("state"), state)
    const loginResult = await exchange_completed_login(base, start, { authorization_code: delivered.searchParams.get("code"), code_verifier })
    assert.equal(loginResult.provider, "wechat")

    const meResponse = await base.fetch(new Request("http://localhost/v1/accounts/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${loginResult.user_token}`,
      },
    }))
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.profile.email, "wechat_wechat-union-id-123@wechat.user")
    assert.equal(me.profile.display_name, "wechat-user")
    assert.equal(me.profile.avatar_url, "https://example.com/wechat-avatar.png")
  } finally {
    globalThis.fetch = originalFetch
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

/** Existing OAuth cases open the landing URL to obtain the browser binding and independent state. */
async function begin_oauth_authorization(base, start) {
  assert.equal(new URL(start.url).pathname, "/v1/accounts/oauth/authorize")
  assert.equal(new URL(start.url).searchParams.get("login_secret"), null)
  assert.equal(start.user_code, undefined)
  const response = await base.fetch(new Request(start.url))
  assert.equal(response.status, 303)
  const provider_url = response.headers.get("location")
  const state = new URL(provider_url).searchParams.get("state")
  assert.ok(state)
  assert.notEqual(state, start.login_id)
  const cookie = response.headers.get("set-cookie")?.split(";")[0]
  assert.ok(cookie)
  return { provider_url, state, cookie }
}

/** Query completion without token delivery, then explicitly exchange the initiating client's proof. */
async function exchange_completed_login(base, start, callback_proof = {}) {
  const proof = { login_id: start.login_id, login_secret: start.login_secret, ...callback_proof }
  const status_response = await base.fetch(jsonRequest("/v1/accounts/login/result", proof))
  assert.equal(status_response.status, 200)
  const status = await status_response.json()
  assert.equal(status.status, callback_proof.authorization_code ? "pending" : "done")
  assert.equal(status.user_token, undefined)
  const missing_proof = await base.fetch(jsonRequest("/v1/accounts/login/result", { login_id: start.login_id }))
  assert.equal(missing_proof.status, 403)
  const exchange_id = crypto.randomUUID()
  const response = await base.fetch(jsonRequest("/v1/accounts/login/exchange", {
    ...proof, exchange_id,
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.status, "done")
  assert.equal(result.user_token.startsWith("ub_"), true)
  const retry = await base.fetch(jsonRequest("/v1/accounts/login/exchange", { ...proof, exchange_id }))
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).user_token, result.user_token)
  const second_exchange = await base.fetch(jsonRequest("/v1/accounts/login/exchange", { ...proof, exchange_id: crypto.randomUUID() }))
  assert.equal(second_exchange.status, 409)
  return result
}

async function setupBase(tempDir, env = {}, accountsOptions = {}) {
  const verification_emails = []
  const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
  const base = new Downtown({ database: db })
  base.use(new EnvService())
  base.use(new AccountsService({
    token_ttl: "7d",
    trusted_web_callbacks: ["https://product.example.com/api/auth/callback"],
    ...accountsOptions,
    providers: [
      emailAccountsProvider({
        send_email: async (message) => { verification_emails.push(message) },
      }),
      githubAccountsProvider(),
      googleAccountsProvider(),
      wechatAccountsProvider(),
    ],
  }))
  await base.health()

  const envProvider = base.get_service("env")._env
  for (const [key, value] of Object.entries(env)) {
    await envProvider.upsert({ key, value: String(value) })
  }

  return {
    base,
    adminSecret: await create_test_admin_session(base),
    verification_emails,
  }
}

function jsonRequest(pathname, body) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function user_request(user_token) {
  return new Request("http://product.local/request", {
    headers: { authorization: `Bearer ${user_token}` },
  })
}

function create_admin(base, admin_secret_key) {
  return create_federation(base, { admin_token: admin_secret_key }).admin
}


function create_federation(base, credentials = {}) {
  return new Downtown({
    url: "http://localhost",
    ...credentials,
    fetch: (input, init) => base.fetch(new Request(input, init)),
  })
}

function readHeader(headers, key) {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(key) ?? undefined
  const loweredKey = key.toLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === loweredKey) return String(value)
  }
  return undefined
}

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
