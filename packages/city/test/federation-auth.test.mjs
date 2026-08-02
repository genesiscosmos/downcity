/**
 * Federation Ed25519 user_token 与 Bureau 本地验签集成测试。
 */

import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { Bureau, Federation, FederationAdmin } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

test("Federation 新数据库使用 Bureau 身份与绑定机器凭证表", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-schema-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const federation = new Federation({ database: db })
    await federation.health()

    const bureau_columns = (await db.query({
      sql: "PRAGMA table_info(federation_bureaus)",
      params: [],
    })).rows
    const token_columns = (await db.query({
      sql: "PRAGMA table_info(federation_bureau_tokens)",
      params: [],
    })).rows
    assert.equal(bureau_columns.some((column) => column.name === "bureau_id"), true)
    assert.equal(bureau_columns.some((column) => column.name === "server_url"), true)
    assert.equal(token_columns.some((column) => column.name === "bureau_id"), true)
    assert.equal((await db.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cities'",
      params: [],
    })).rows.length, 0)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation 拒绝旧 City 身份表和无法确定归属的 Bureau Token", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-legacy-identity-schema-"))
  try {
    const city_db = createSqliteDb(path.join(temp_dir, "legacy-city.sqlite"))
    await city_db.execute_ddl("CREATE TABLE cities (city_id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    await assert.rejects(
      new Federation({ database: city_db }).health(),
      /identity schema migration required: legacy cities table exists/,
    )

    const token_db = createSqliteDb(path.join(temp_dir, "legacy-token.sqlite"))
    await token_db.execute_ddl("CREATE TABLE federation_bureau_tokens (token_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, status TEXT NOT NULL)")
    await assert.rejects(
      new Federation({ database: token_db }).health(),
      /identity schema migration required: legacy Bureau Token records have no bureau_id/,
    )

    const bureau_db = createSqliteDb(path.join(temp_dir, "legacy-bureau.sqlite"))
    await bureau_db.execute_ddl("CREATE TABLE federation_bureaus (bureau_id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT NOT NULL)")
    await assert.rejects(
      new Federation({ database: bureau_db }).health(),
      /identity schema migration required: legacy Bureau records have no server_url/,
    )
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation 注册 Bureau 服务入口并按 User Token 解析当前 Bureau", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-current-bureau-"))
  try {
    const federation = new Federation({
      database: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    const created = await admin.bureaus.create({
      name: "Product A",
      server_url: "https://bureau.example.com/",
    })
    const second = await admin.bureaus.create({
      name: "Product B",
      server_url: "https://bureau.example.com",
    })
    assert.equal(created.server_url, "https://bureau.example.com")
    assert.equal(second.server_url, created.server_url)

    const updated = await admin.bureaus.update_server_url({
      bureau_id: created.bureau_id,
      server_url: "https://new-bureau.example.com/",
    })
    assert.equal(updated.server_url, "https://new-bureau.example.com")

    const issued = await (await federation.getAuthenticator()).createToken({
      bureau_id: created.bureau_id,
      user_id: "user_1",
      ttl: "1h",
    })
    const response = await federation.fetch(new Request("http://localhost/v1/bureaus/current", {
      headers: { authorization: `Bearer ${issued.user_token}` },
    }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).bureau.server_url, "https://new-bureau.example.com")
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation 不默认创建 Bureau Token，Bureau 使用 JWKS 本地验签", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-local-"))
  try {
    const federation = new Federation({
      database: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    assert.deepEqual(await admin.bureaus.list(), [])
    const bureau_record = await admin.bureaus.create({
      bureau_id: "bureau_downcity",
      name: "Downcity",
      server_url: "https://bureau.example.com",
    })

    const unauthorized = await federation.fetch(new Request("http://localhost/v1/bureaus/tokens/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bureau_id: bureau_record.bureau_id,
        token_id: "br_1234567890abcdef",
        purpose: "unauthorized test",
        token_hash: "1234567890123456789012345678901234567890123",
      }),
    }))
    assert.equal(unauthorized.status, 401)

    const credential = await register_bureau(admin, bureau_record.bureau_id)
    const user_token = await (await federation.getAuthenticator()).createToken({
      bureau_id: "bureau_downcity",
      user_id: "user_1",
      metadata: { plan: "pro" },
      ttl: "1h",
    })
    const requested_paths = []
    const bureau = new Bureau({
      federation_url: "https://fed.example.com",
      bureau_token: credential.bureau_token,
      fetch: async (input, init) => {
        requested_paths.push(new URL(String(input)).pathname)
        return federation.fetch(new Request(input, init))
      },
    })
    const request = new Request("https://product.example.com/private", {
      headers: { authorization: `Bearer ${user_token.user_token}` },
    })

    const first = await bureau.identify(request)
    const second = await bureau.identify(request)
    assert.deepEqual(first, second)
    assert.equal(first.user_id, "user_1")
    assert.equal(first.bureau_id, "bureau_downcity")
    assert.deepEqual(first.metadata, { plan: "pro" })
    assert.deepEqual(requested_paths, [
      "/v1/bureaus/me",
      "/.well-known/downcity.json",
      "/.well-known/jwks.json",
    ])
    assert.equal(requested_paths.includes("/v1/accounts/identify"), false)

    const items = await admin.bureaus.tokens.list(bureau_record.bureau_id)
    assert.equal(items.length, 1)
    assert.equal(items[0].purpose, "federation auth test")
    assert.equal(items[0].bureau_id, bureau_record.bureau_id)
    assert.equal("token_hash" in items[0], false)
    assert.equal("bureau_token" in items[0], false)

    await admin.bureaus.tokens.revoke(credential.token_id)
    const revoked = create_bureau(federation, credential.bureau_token)
    await assert.rejects(revoked.identify(request), (error) => error?.message.includes("unavailable"))
    await assert.rejects(revoked.me(), (error) => error?.message.includes("unavailable"))
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Bureau 拒绝签给另一个 Bureau 的有效 user_token", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-city-"))
  try {
    const federation = new Federation({
      database: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    const primary_bureau = await admin.bureaus.create({ bureau_id: "bureau_downcity", name: "Primary Product", server_url: "https://primary.example.com" })
    const other_bureau = await admin.bureaus.create({ name: "Other Product", server_url: "https://other.example.com" })
    const credential = await register_bureau(admin, primary_bureau.bureau_id)
    const user_token = await (await federation.getAuthenticator()).createToken({
      bureau_id: other_bureau.bureau_id,
      user_id: "user_1",
      ttl: "1h",
    })

    await assert.rejects(
      create_bureau(federation, credential.bureau_token).identify(user_token.user_token),
      (error) => error?.statusCode === 401,
    )
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Bureau 拒绝被修改签名的 user_token", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-signature-"))
  try {
    const federation = new Federation({
      database: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    const bureau_record = await admin.bureaus.create({ bureau_id: "bureau_downcity", name: "Downcity", server_url: "https://bureau.example.com" })
    const credential = await register_bureau(admin, bureau_record.bureau_id)
    const user_token = await (await federation.getAuthenticator()).createToken({
      bureau_id: "bureau_downcity",
      user_id: "user_1",
      ttl: "1h",
    })
    const segments = user_token.user_token.split(".")
    segments[2] = `${segments[2][0] === "A" ? "B" : "A"}${segments[2].slice(1)}`
    const modified = segments.join(".")

    await assert.rejects(
      create_bureau(federation, credential.bureau_token).identify(modified),
      (error) => error?.statusCode === 401
        && error.message === "Invalid user token signature",
    )
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation issuer 和签名公钥在 runtime 重启后保持不变", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-key-restart-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const first = new Federation({ database: db })
    await first.health()
    const first_discovery = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/downcity.json",
    ))).json()
    const first_jwks = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/jwks.json",
    ))).json()

    const second = new Federation({ database: db })
    await second.health()
    const second_discovery = await (await second.fetch(new Request(
      "https://fed.example.com/.well-known/downcity.json",
    ))).json()
    const second_jwks = await (await second.fetch(new Request(
      "https://fed.example.com/.well-known/jwks.json",
    ))).json()

    assert.equal(second_discovery.issuer, first_discovery.issuer)
    assert.equal(second_jwks.keys[0].kid, first_jwks.keys[0].kid)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("多个 Federation 实例并发首次启动时共享唯一 issuer 和 active signing key", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-concurrent-init-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const federations = Array.from({ length: 8 }, () => new Federation({ database: db }))

    await Promise.all(federations.map((federation) => federation.health()))

    const key_rows = await (await federations[0].table("federation_auth_keys")).select()
    assert.equal(key_rows.filter((row) => row.status === "active").length, 1)
    assert.equal(key_rows.length, 1)

    const env_rows = await (await federations[0].table("env")).select()
    assert.equal(env_rows.length, 3)
    assert.equal(new Set(env_rows.map((row) => row.key)).size, 3)

    const discoveries = await Promise.all(federations.map(async (federation) => (
      await (await federation.fetch(new Request(
        "https://fed.example.com/.well-known/downcity.json",
      ))).json()
    )))
    assert.equal(new Set(discoveries.map((item) => item.issuer)).size, 1)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation 启动时将历史多 active signing key 自动收敛为最早的一把", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-key-reconcile-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const first = new Federation({ database: db })
    await first.health()

    const key_table = await first.table("federation_auth_keys")
    const [original_key] = await key_table.select()
    assert.ok(original_key)

    await db.execute_ddl('DROP INDEX "federation_auth_keys_one_active"')
    await key_table.update({
      where: { key_id: original_key.key_id },
      values: { created_at: "2026-01-03T00:00:00.000Z" },
    })
    await key_table.insert([
      clone_auth_key(original_key, "key_legacy_oldest", "2026-01-01T00:00:00.000Z"),
      clone_auth_key(original_key, "key_legacy_middle", "2026-01-02T00:00:00.000Z"),
    ])

    const recovered = new Federation({ database: db })
    await recovered.health()

    const recovered_rows = await (await recovered.table("federation_auth_keys")).select()
    const active_rows = recovered_rows.filter((row) => row.status === "active")
    const retired_rows = recovered_rows.filter((row) => row.status === "retired")
    assert.equal(active_rows.length, 1)
    assert.equal(active_rows[0].key_id, "key_legacy_oldest")
    assert.equal(retired_rows.length, 2)
    assert.ok(retired_rows.every((row) => typeof row.retired_at === "string" && row.retired_at.length > 0))

    const authenticator = await recovered.getAuthenticator()
    const admin = await create_admin(recovered)
    await admin.bureaus.create({ bureau_id: "bureau_downcity", name: "Downcity", server_url: "https://bureau.example.com" })
    const issued = await authenticator.createToken({
      bureau_id: "bureau_downcity",
      user_id: "user_recovered",
      ttl: "1h",
    })
    const payload = await authenticator.verifyToken(issued.user_token)
    assert.equal(payload.user_id, "user_recovered")
    assert.equal((await authenticator.get_public_jwks()).keys.length, 3)

    await assert.rejects(
      key_table.insert(clone_auth_key(original_key, "key_forbidden_active", "2026-01-04T00:00:00.000Z")),
      (error) => String(error?.message).includes("UNIQUE constraint failed"),
    )
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

function create_bureau(federation, bureau_token) {
  return new Bureau({
    federation_url: "http://localhost",
    bureau_token,
    fetch: (input, init) => federation.fetch(new Request(input, init)),
  })
}

async function create_admin(federation) {
  const rows = await (await federation.table("env")).select({
    key: "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY",
  })
  return new FederationAdmin({
    base_url: "http://localhost",
    credential: rows[0]?.value ?? "",
    fetch: (input, init) => federation.fetch(new Request(input, init)),
  })
}

async function register_bureau(admin, bureau_id) {
  const token_id = `br_${randomBytes(12).toString("base64url")}`
  const bureau_token = `fb_${token_id}.${randomBytes(32).toString("base64url")}`
  const token_hash = createHash("sha256").update(bureau_token, "utf8").digest("base64url")
  const registered = await admin.bureaus.tokens.register({
    bureau_id,
    token_id,
    purpose: "federation auth test",
    token_hash,
  })
  assert.equal(registered.token_id, token_id)
  assert.equal("token_hash" in registered, false)
  assert.equal("bureau_token" in registered, false)
  return { token_id, bureau_token }
}

/** 创建用于模拟旧版本并发脏数据的签名密钥记录。 */
function clone_auth_key(source, key_id, created_at) {
  return {
    ...source,
    key_id,
    public_jwk: JSON.stringify({ ...JSON.parse(source.public_jwk), kid: key_id }),
    private_jwk: JSON.stringify({ ...JSON.parse(source.private_jwk), kid: key_id }),
    status: "active",
    created_at,
    retired_at: "",
  }
}
