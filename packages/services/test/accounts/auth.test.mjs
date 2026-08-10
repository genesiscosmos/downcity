import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Bureau, City, Federation, FederationAdmin } from "@downcity/city"
import { createSqliteDb } from "./sqlite-db.mjs"
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
    const { base, adminSecret } = await setupBase(tempDir)

    const city = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()

    const registerResponse = await base.fetch(jsonRequest("/v1/accounts/register", {
      email: "USER@example.com",
      password: "password123",
    }))
    assert.equal(registerResponse.status, 200)
    const registered = await registerResponse.json()
    assert.equal(registered.success, true)
    assert.equal(typeof registered.user_id, "string")

    if (registered.verification_token) {
      const verifyResponse = await base.fetch(jsonRequest("/v1/accounts/verify-email", {
        token: registered.verification_token,
        bureau_id: city.bureau_id,
      }))
      assert.equal(verifyResponse.status, 200)
      const verified = await verifyResponse.json()
      assert.equal(verified.user_token.startsWith("ub_"), true)
    }

    const authStartResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "email",
      bureau_id: city.bureau_id,
    }))
    assert.equal(authStartResponse.status, 200)
    const authStarted = await authStartResponse.json()
    assert.equal(authStarted.status, "input_required")
    assert.equal(authStarted.provider, "email")
    assert.equal(typeof authStarted.login_id, "string")
    assert.equal(authStarted.inputs.length, 2)

    const authContinueResponse = await base.fetch(jsonRequest("/v1/accounts/login/continue", {
      login_id: authStarted.login_id,
      input: {
        email: "user@example.com",
        password: "password123",
      },
    }))
    assert.equal(authContinueResponse.status, 200)
    const authContinued = await authContinueResponse.json()
    assert.equal(authContinued.status, "done")
    assert.equal(authContinued.login_id, authStarted.login_id)

    const authResultResponse = await base.fetch(new Request(`http://localhost/v1/accounts/login/result?login_id=${authStarted.login_id}`))
    assert.equal(authResultResponse.status, 200)
    const authResult = await authResultResponse.json()
    assert.equal(authResult.status, "done")
    assert.equal(authResult.provider, "email")
    assert.equal(authResult.user_token.startsWith("ub_"), true)

    const meResponse = await base.fetch(new Request("http://localhost/v1/accounts/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${authResult.user_token}`,
      },
    }))
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.user.user_id, registered.user_id)
    assert.equal(me.user.bureau_id, city.bureau_id)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("City 直读 Profile，Bureau 本地验签后按需读取同一 Federation Profile", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-bureau-"))

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir)
    const admin = create_admin(base, adminSecret)
    const bureau_a_record = await admin.bureaus.create({ name: "Product A", server_url: "https://bureau-a.example.com" })
    const bureau_b_record = await admin.bureaus.create({ name: "Product B", server_url: "https://bureau-b.example.com" })
    const token_a = await register_bureau(admin, bureau_a_record.bureau_id)
    const token_b = await register_bureau(admin, bureau_b_record.bureau_id)

    const registered = await (await base.fetch(jsonRequest("/v1/accounts/register", {
      email: "bureau@example.com",
      password: "password123",
    }))).json()
    const user_token = await admin.service("accounts").action("tokens/issue").invoke({
      bureau_id: bureau_a_record.bureau_id,
      user_id: registered.user_id,
      ttl: "1h",
    })

    const city_client = create_city(base, user_token.user_token)
    const city_profile = await city_client.user().profile()
    assert.equal(city_profile.user_id, registered.user_id)

    const bureau_a = create_bureau(base, token_a.bureau_token)
    const bureau_user = await bureau_a.user(user_request(user_token.user_token))
    assert.equal(bureau_user.identity.user_id, registered.user_id)
    assert.equal(bureau_user.identity.bureau_id, bureau_a_record.bureau_id)
    const bureau_profile = await bureau_user.profile()
    assert.deepEqual(bureau_profile, city_profile)

    const bureau_b = create_bureau(base, token_b.bureau_token)
    await assert.rejects(
      bureau_b.identify(user_request(user_token.user_token)),
      (error) => error?.statusCode === 401,
    )
    await assert.rejects(
      bureau_a.identify(user_request(`${user_token.user_token}invalid`)),
      (error) => error?.statusCode === 401,
    )
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

    const city = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "Local Demo", server_url: "https://bureau.example.com" },
    }))).json()

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
      bureau_id: city.bureau_id,
    }))
    assert.equal(authStartResponse.status, 200)
    const authStarted = await authStartResponse.json()
    assert.equal(authStarted.status, "done")
    assert.equal(authStarted.provider, "local")
    assert.equal(typeof authStarted.login_id, "string")

    const authResultResponse = await base.fetch(new Request(`http://localhost/v1/accounts/login/result?login_id=${authStarted.login_id}`))
    assert.equal(authResultResponse.status, 200)
    const authResult = await authResultResponse.json()
    assert.equal(authResult.status, "done")
    assert.equal(authResult.provider, "local")
    assert.equal(authResult.user_id, "local-user")
    assert.equal(authResult.user_token.startsWith("ub_"), true)

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

test("accountsService exposes better-auth passthrough as an installed public route", async () => {
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

    assert.notEqual(response.status, 401)
    assert.doesNotMatch(body, /Authentication required/)
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
    const base = new Federation({ database: db })
    base.use(new AccountsService({ token_ttl: "7d" }))
    await base.health()

    const admin_secret = await readEnvValue(base, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const bureau = await (await base.fetch(adminRequest(admin_secret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()

    const providersResponse = await base.fetch(new Request("http://localhost/v1/accounts/providers"))
    assert.equal(providersResponse.status, 200)
    assert.deepEqual(await providersResponse.json(), { items: [] })

    const loginResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "email",
      bureau_id: bureau.bureau_id,
    }))
    assert.equal(loginResponse.status, 400)
    assert.deepEqual(await loginResponse.json(), { error: "email provider not configured" })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("accountsService completes Google OAuth callback and resolves the state token", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))
  const originalFetch = globalThis.fetch

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir, {
      GOOGLE_CLIENT_ID: "google_client_id",
      GOOGLE_CLIENT_SECRET: "google_client_secret",
    })

    const city = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()

    const startResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "google",
      bureau_id: city.bureau_id,
    }))
    assert.equal(startResponse.status, 200)
    const start = await startResponse.json()
    assert.equal(start.status, "redirect_required")
    assert.equal(typeof start.login_id, "string")
    assert.equal(start.state, start.login_id)
    assert.equal(typeof start.state, "string")
    assert.equal(start.provider, "google")
    assert.match(start.url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)

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

    const callbackResponse = await base.fetch(new Request(`http://localhost/v1/accounts/oauth/callback?state=${start.state}&code=test-google-code`))
    assert.equal(callbackResponse.status, 200)
    assert.match(await callbackResponse.text(), /Login Successful/)

    const loginResultResponse = await base.fetch(new Request(`http://localhost/v1/accounts/login/result?login_id=${start.login_id}`))
    assert.equal(loginResultResponse.status, 200)
    const loginResult = await loginResultResponse.json()
    assert.equal(loginResult.status, "done")
    assert.equal(loginResult.provider, "google")
    assert.equal(loginResult.user_token.startsWith("ub_"), true)

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

test("accountsService completes WeChat website OAuth callback and resolves the state token", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-accounts-service-"))
  const originalFetch = globalThis.fetch

  try {
    process.chdir(tempDir)
    const { base, adminSecret } = await setupBase(tempDir, {
      WECHAT_CLIENT_ID: "wechat_client_id",
      WECHAT_CLIENT_SECRET: "wechat_client_secret",
    })

    const city = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()

    const startResponse = await base.fetch(jsonRequest("/v1/accounts/login/start", {
      provider: "wechat",
      bureau_id: city.bureau_id,
    }))
    assert.equal(startResponse.status, 200)
    const start = await startResponse.json()
    assert.equal(start.status, "redirect_required")
    assert.equal(typeof start.login_id, "string")
    assert.equal(start.state, start.login_id)
    assert.equal(typeof start.state, "string")
    assert.equal(start.provider, "wechat")
    assert.match(start.url, /^https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect\?/)
    assert.match(start.url, /scope=snsapi_login/)

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

    const callbackResponse = await base.fetch(new Request(`http://localhost/v1/accounts/oauth/callback?state=${start.state}&code=test-wechat-code`))
    assert.equal(callbackResponse.status, 200)
    assert.match(await callbackResponse.text(), /Login Successful/)

    const loginResultResponse = await base.fetch(new Request(`http://localhost/v1/accounts/login/result?login_id=${start.login_id}`))
    assert.equal(loginResultResponse.status, 200)
    const loginResult = await loginResultResponse.json()
    assert.equal(loginResult.status, "done")
    assert.equal(loginResult.provider, "wechat")
    assert.equal(loginResult.user_token.startsWith("ub_"), true)

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

async function setupBase(tempDir, env = {}, accountsOptions = {}) {
  const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
  const base = new Federation({ database: db })
  base.use(new AccountsService({
    token_ttl: "7d",
    ...accountsOptions,
    providers: [
      emailAccountsProvider({
        send_email: async () => {},
      }),
      githubAccountsProvider(),
      googleAccountsProvider(),
      wechatAccountsProvider(),
    ],
  }))
  await base.health()

  const envProvider = base.getService("env")._env
  for (const [key, value] of Object.entries(env)) {
    await envProvider.upsert({ key, value: String(value) })
  }

  return {
    base,
    adminSecret: await readEnvValue(base, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY"),
  }
}

async function readEnvValue(base, key) {
  const envTable = await base.table("env")
  const rows = await envTable.select({ key })
  return rows[0]?.value ?? ""
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

function create_bureau(base, bureau_token) {
  return new Bureau({
    federation_url: "http://localhost",
    bureau_token,
    fetch: (input, init) => base.fetch(new Request(input, init)),
  })
}

function create_admin(base, admin_secret_key) {
  return new FederationAdmin({
    base_url: "http://localhost",
    credential: admin_secret_key,
    fetch: (input, init) => base.fetch(new Request(input, init)),
  })
}

async function register_bureau(admin, bureau_id) {
  const token_id = `br_${randomBytes(12).toString("base64url")}`
  const bureau_token = `fb_${token_id}.${randomBytes(32).toString("base64url")}`
  const token_hash = createHash("sha256").update(bureau_token, "utf8").digest("base64url")
  await admin.bureaus.tokens.register({ bureau_id, token_id, purpose: "accounts auth test", token_hash })
  return { token_id, bureau_token }
}

function create_city(base, user_token) {
  return new City({
    federation_url: "http://localhost",
    user_token,
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
