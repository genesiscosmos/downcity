/**
 * Federation Ed25519 user_token 与 Bureau 本地验签集成测试。
 */

import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { Bureau, Federation } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

test("Federation 为旧 Bureau Token 表补充 purpose 字段", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-migration-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    db.raw.exec(`
      CREATE TABLE federation_bureau_tokens (
        token_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO federation_bureau_tokens (
        token_id, token_hash, status, created_at, updated_at
      ) VALUES (
        'br_1234567890abcdef',
        '1234567890123456789012345678901234567890123',
        'revoked',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `)

    const federation = new Federation({ db })
    await federation.health()
    const columns = db.raw.prepare("PRAGMA table_info(federation_bureau_tokens)").all()
    assert.equal(columns.some((column) => column.name === "purpose"), true)

    const admin = await create_admin(federation)
    const items = await admin.bureaus.list()
    assert.equal(items[0].purpose, "")
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Federation 不默认创建 Bureau Token，Bureau 使用 JWKS 本地验签", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-local-"))
  try {
    const federation = new Federation({
      db: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    assert.deepEqual(await admin.bureaus.list(), [])

    const unauthorized = await federation.fetch(new Request("http://localhost/v1/bureaus/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token_id: "br_1234567890abcdef",
        purpose: "unauthorized test",
        token_hash: "1234567890123456789012345678901234567890123",
      }),
    }))
    assert.equal(unauthorized.status, 401)

    const credential = await register_bureau(admin)
    const user_token = await (await federation.getAuthenticator()).createToken({
      city_id: "city_downcity",
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
    assert.equal(first.city_id, "city_downcity")
    assert.deepEqual(first.metadata, { plan: "pro" })
    assert.deepEqual(requested_paths, [
      "/.well-known/downcity.json",
      "/.well-known/jwks.json",
    ])
    assert.equal(requested_paths.includes("/v1/accounts/identify"), false)

    const items = await admin.bureaus.list()
    assert.equal(items.length, 1)
    assert.equal(items[0].purpose, "federation auth test")
    assert.equal("name" in items[0], false)
    assert.equal("token_hash" in items[0], false)
    assert.equal("bureau_token" in items[0], false)

    await admin.bureaus.revoke(credential.token_id)
    const revoked = create_bureau(federation, credential.bureau_token)
    assert.equal((await revoked.identify(request)).user_id, "user_1")
    await assert.rejects(revoked.bureaus.list(), (error) => error?.message.includes("401"))
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Bureau 接受同一 Federation 下不同 City 的有效 user_token", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-city-"))
  try {
    const federation = new Federation({
      db: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    const other_city = await admin.cities.create({ name: "Other Product" })
    const credential = await register_bureau(admin)
    const user_token = await (await federation.getAuthenticator()).createToken({
      city_id: "city_downcity",
      user_id: "user_1",
      ttl: "1h",
    })

    const identity = await create_bureau(federation, credential.bureau_token).identify(user_token.user_token)
    assert.equal(identity.city_id, "city_downcity")
    assert.notEqual(identity.city_id, other_city.city_id)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Bureau 拒绝被修改签名的 user_token", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bureau-signature-"))
  try {
    const federation = new Federation({
      db: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    await federation.health()
    const admin = await create_admin(federation)
    const credential = await register_bureau(admin)
    const user_token = await (await federation.getAuthenticator()).createToken({
      city_id: "city_downcity",
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
    const first = new Federation({ db })
    await first.health()
    const first_discovery = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/downcity.json",
    ))).json()
    const first_jwks = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/jwks.json",
    ))).json()

    const second = new Federation({ db })
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
    const federations = Array.from({ length: 8 }, () => new Federation({ db }))

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
    const first = new Federation({ db })
    await first.health()

    const key_table = await first.table("federation_auth_keys")
    const [original_key] = await key_table.select()
    assert.ok(original_key)

    db.raw.exec('DROP INDEX "federation_auth_keys_one_active"')
    await key_table.update({
      where: { key_id: original_key.key_id },
      values: { created_at: "2026-01-03T00:00:00.000Z" },
    })
    await key_table.insert([
      clone_auth_key(original_key, "key_legacy_oldest", "2026-01-01T00:00:00.000Z"),
      clone_auth_key(original_key, "key_legacy_middle", "2026-01-02T00:00:00.000Z"),
    ])

    const recovered = new Federation({ db })
    await recovered.health()

    const recovered_rows = await (await recovered.table("federation_auth_keys")).select()
    const active_rows = recovered_rows.filter((row) => row.status === "active")
    const retired_rows = recovered_rows.filter((row) => row.status === "retired")
    assert.equal(active_rows.length, 1)
    assert.equal(active_rows[0].key_id, "key_legacy_oldest")
    assert.equal(retired_rows.length, 2)
    assert.ok(retired_rows.every((row) => typeof row.retired_at === "string" && row.retired_at.length > 0))

    const authenticator = await recovered.getAuthenticator()
    const issued = await authenticator.createToken({
      city_id: "city_downcity",
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
  return new Bureau({
    federation_url: "http://localhost",
    bureau_token: rows[0]?.value ?? "",
    fetch: (input, init) => federation.fetch(new Request(input, init)),
  })
}

async function register_bureau(admin) {
  const token_id = `br_${randomBytes(12).toString("base64url")}`
  const bureau_token = `fb_${token_id}.${randomBytes(32).toString("base64url")}`
  const token_hash = createHash("sha256").update(bureau_token, "utf8").digest("base64url")
  const registered = await admin.bureaus.register({
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
