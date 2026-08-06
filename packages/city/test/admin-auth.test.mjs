/** Federation 管理员登录、会话与部署恢复安全边界测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import {
  Federation,
  create_federation_admin_password_hash,
} from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

const INITIAL_ADMIN = {
  provision_id: "fap_initial",
  admin_id: "admin_initial",
  password_hash: "pbkdf2_sha256$210000$m-wik-AJwXBqFD5AAqctMWDFqQioRh2_$tM1r37AT7NvKTiQyFePgpR7K9EC5tZ487xCV_MZQEtE",
}

/** 新管理员摘要使用 Cloudflare Workers 可执行的 PBKDF2 迭代次数。 */
test("Federation administrator password hash uses Worker-compatible PBKDF2 iterations", async () => {
  const password_hash = await create_federation_admin_password_hash("worker-compatible-password")
  assert.match(password_hash, /^pbkdf2_sha256\$100000\$/u)
})

/** 管理员密码只保存摘要，登录返回的 Session 可访问管理接口并支持退出。 */
test("Federation administrator login stores no plaintext credential and issues revocable sessions", async () => {
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  await federation.health()
  await write_administrator(federation, INITIAL_ADMIN)

  const administrator = (await (await federation.table("federation_administrators")).select())[0]
  assert.equal(administrator.admin_id, "admin_initial")
  assert.notEqual(administrator.password_hash, "test-admin-password")
  assert.equal(JSON.stringify(administrator).includes("test-admin-password"), false)

  const login_result = await login(federation, "admin_initial", "test-admin-password")
  assert.equal(login_result.response.status, 200)
  assert.equal(login_result.response.headers.get("cache-control"), "no-store")
  assert.match(login_result.body.session_token, /^fadm_/)

  const instruction = await federation.fetch(new Request("http://localhost/v1/federation/instruction", {
    headers: { authorization: `Bearer ${login_result.body.session_token}` },
  }))
  assert.equal(instruction.status, 200)

  const stored_session = (await (await federation.table("federation_admin_sessions")).select())[0]
  assert.notEqual(stored_session.token_hash, login_result.body.session_token)
  assert.equal(JSON.stringify(stored_session).includes(login_result.body.session_token), false)

  const logout = await federation.fetch(new Request("http://localhost/v1/admin/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${login_result.body.session_token}` },
  }))
  assert.equal(logout.status, 200)
  const rejected = await federation.fetch(new Request("http://localhost/v1/federation/instruction", {
    headers: { authorization: `Bearer ${login_result.body.session_token}` },
  }))
  assert.equal(rejected.status, 401)
})

/** 部署控制面直接更新管理员数据库并撤销全部旧会话。 */
test("Federation administrator database reset revokes previous sessions", async () => {
  const database = createSqliteDb(":memory:")
  const first = new Federation({ database })
  await first.health()
  await write_administrator(first, INITIAL_ADMIN)
  const old_login = await login(first, "admin_initial", "test-admin-password")
  assert.equal(old_login.response.status, 200)

  const reset_administrator = {
    provision_id: "fap_reset_once",
    admin_id: "admin_recovered",
    password_hash: await create_federation_admin_password_hash("recovered-password"),
  }
  const administrator_table = await first.table("federation_administrators")
  const session_table = await first.table("federation_admin_sessions")
  const now = new Date().toISOString()
  await administrator_table.update({
    where: { owner_slot: "owner" },
    values: { ...reset_administrator, status: "active", failed_attempts: "0", locked_until: "", updated_at: now },
  })
  for (const session of await session_table.select({ status: "active" })) {
    await session_table.update({
      where: { session_id: session.session_id },
      values: { status: "revoked", revoked_at: now },
    })
  }
  const recovered = new Federation({ database })
  await recovered.health()

  const old_session = await recovered.fetch(new Request("http://localhost/v1/federation/instruction", {
    headers: { authorization: `Bearer ${old_login.body.session_token}` },
  }))
  assert.equal(old_session.status, 401)
  assert.equal((await login(recovered, "admin_initial", "test-admin-password")).response.status, 401)
  assert.equal((await login(recovered, "admin_recovered", "recovered-password")).response.status, 200)

  const idempotent = new Federation({ database })
  await idempotent.health()
  assert.equal((await login(idempotent, "admin_recovered", "recovered-password")).response.status, 200)
})

/** 模拟部署控制面直接写入初始管理员记录。 */
async function write_administrator(federation, administrator) {
  const now = new Date().toISOString()
  await (await federation.table("federation_administrators")).insert({
    owner_slot: "owner",
    ...administrator,
    status: "active",
    failed_attempts: "0",
    locked_until: "",
    created_at: now,
    updated_at: now,
  })
}

/** 调用 Federation 管理员登录端点并解析响应。 */
async function login(federation, admin_id, password) {
  const response = await federation.fetch(new Request("http://localhost/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ admin_id, password }),
  }))
  return { response, body: await response.json() }
}
