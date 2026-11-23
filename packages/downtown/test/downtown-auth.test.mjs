/**
 * Downtown 用户会话签名、权限隔离、撤销与持久密钥集成验证。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { decodeJwt, importJWK, SignJWT } from "jose"

import {
  Downtown,
  base64UrlDecode,
  base64UrlEncode,
} from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session, create_test_downtown } from "./admin-fixture.mjs"

test("Base64URL 解码兼容 Cloudflare atob 的无 padding 摘要", () => {
  const value = "cloudflare-base64url-padding"
  const encoded = base64UrlEncode(value)
  assert.equal(encoded.endsWith("="), false)
  assert.equal(base64UrlDecode(encoded), value)
})

test("用户会话无需产品或 City，仍验证签名、受众、签发者、期限及撤销", async () => {
  const downtown = create_test_downtown({ database: createSqliteDb(":memory:") })
  try {
    await downtown.ready()
    const authority = await downtown.runtime.get_authenticator()
    const issued = await authority.createToken({ user_id: "owner", ttl: "1h" })
    const payload = decodeJwt(issued.user_token.slice(3))
    assert.equal("bureau_id" in payload, false)
    assert.equal("city_id" in payload, false)
    assert.equal((await authority.verifyToken(issued.user_token)).user_id, "owner")
    const status = (token, city_id) => downtown.fetch(new Request("http://localhost/v1/downtown/token", {
      headers: { authorization: `Bearer ${token}`, ...(city_id ? { "x-downcity-city-id": city_id } : {}) },
    }))
    assert.equal((await status(issued.user_token)).status, 200)
    assert.equal((await status(issued.user_token, "city_any")).status, 200)
    const [key] = await (await downtown.table("downtown_auth_keys")).select()
    const private_key = await importJWK(JSON.parse(key.private_jwk), "EdDSA")
    for (const change of [{ iss: "urn:other" }, { aud: "other" }, { exp: Math.floor(Date.now()/1000)-10 }, { sub: "another" }]) {
      const forged = await new SignJWT({ ...payload, ...change }).setProtectedHeader({ alg: "EdDSA", kid: key.key_id }).sign(private_key)
      assert.equal((await status(`ub_${forged}`)).status, 401)
    }
    const parts = issued.user_token.split(".")
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1)
    assert.equal((await status(parts.join("."))).status, 401)
    await authority.revoke_user_token(issued.user_token)
    await authority.revoke_user_token(issued.user_token)
    assert.equal((await status(issued.user_token)).status, 401)
    assert.equal((await downtown.fetch(new Request("http://localhost/v1/admin/session", {
      headers: { authorization: `Bearer ${issued.user_token}`, "x-downcity-city-id": "city_any" },
    }))).status, 401)
    for (const table of ["downtown_bureaus", "downtown_bureau_servers", "downtown_bureau_tokens"]) {
      const result = await downtown.runtime.options.database.query({ sql: `PRAGMA table_info(${table})`, params: [] })
      assert.equal(result.rows.length, 0)
    }
  } finally { await downtown.dispose() }
})

test("Downtown issuer 和签名公钥在 runtime 重启后保持不变", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-key-restart-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const first = create_test_downtown({ database: db })
    await first.health()
    const first_discovery = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/downcity.json",
    ))).json()
    const first_jwks = await (await first.fetch(new Request(
      "https://fed.example.com/.well-known/jwks.json",
    ))).json()

    const second = create_test_downtown({ database: db })
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

test("多个 Downtown 实例并发首次启动时共享唯一 issuer 和 active signing key", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-concurrent-init-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const downtowns = Array.from({ length: 8 }, () => create_test_downtown({ database: db }))

    await Promise.all(downtowns.map((downtown) => downtown.health()))

    const key_rows = await (await downtowns[0].table("downtown_auth_keys")).select()
    assert.equal(key_rows.filter((row) => row.status === "active").length, 1)
    assert.equal(key_rows.length, 1)

    const env_rows = await (await downtowns[0].table("env")).select()
    assert.equal(env_rows.length, 3)
    assert.equal(new Set(env_rows.map((row) => row.key)).size, 3)

    const discoveries = await Promise.all(downtowns.map(async (downtown) => (
      await (await downtown.fetch(new Request(
        "https://fed.example.com/.well-known/downcity.json",
      ))).json()
    )))
    assert.equal(new Set(discoveries.map((item) => item.issuer)).size, 1)
  } finally {
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("Downtown 启动时将历史多 active signing key 自动收敛为最早的一把", async () => {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-fed-key-reconcile-"))
  try {
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const first = create_test_downtown({ database: db })
    await first.health()

    const key_table = await first.table("downtown_auth_keys")
    const [original_key] = await key_table.select()
    assert.ok(original_key)

    await db.execute_ddl('DROP INDEX "downtown_auth_keys_one_active"')
    await key_table.update({
      where: { key_id: original_key.key_id },
      values: { created_at: "2026-01-03T00:00:00.000Z" },
    })
    await key_table.insert([
      clone_auth_key(original_key, "key_legacy_oldest", "2026-01-01T00:00:00.000Z"),
      clone_auth_key(original_key, "key_legacy_middle", "2026-01-02T00:00:00.000Z"),
    ])

    const recovered = create_test_downtown({ database: db })
    await recovered.health()

    const recovered_rows = await (await recovered.table("downtown_auth_keys")).select()
    const active_rows = recovered_rows.filter((row) => row.status === "active")
    const retired_rows = recovered_rows.filter((row) => row.status === "retired")
    assert.equal(active_rows.length, 1)
    assert.equal(active_rows[0].key_id, "key_legacy_oldest")
    assert.equal(retired_rows.length, 2)
    assert.ok(retired_rows.every((row) => typeof row.retired_at === "string" && row.retired_at.length > 0))

    const authenticator = await recovered.runtime.get_authenticator()
    const issued = await authenticator.createToken({
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
