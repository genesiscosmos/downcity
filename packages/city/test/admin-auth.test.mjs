/** Federation 管理员登录、会话与部署恢复安全边界测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import {
  Federation,
  create_federation_admin_password_hash,
} from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

const INITIAL_ADMIN = {
  mode: "initialize",
  provision_id: "fap_initial",
  admin_id: "admin_initial",
  password_hash: "pbkdf2_sha256$210000$m-wik-AJwXBqFD5AAqctMWDFqQioRh2_$tM1r37AT7NvKTiQyFePgpR7K9EC5tZ487xCV_MZQEtE",
}

/** 管理员密码只保存摘要，登录返回的 Session 可访问管理接口并支持退出。 */
test("Federation administrator login stores no plaintext credential and issues revocable sessions", async () => {
  const federation = new Federation({ database: createSqliteDb(":memory:"), admin_provisioning: INITIAL_ADMIN })
  await federation.health()

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

/** 显式 reset provisioning 更新管理员并立即使全部旧会话失效。 */
test("Federation administrator reset requires explicit provisioning and revokes previous sessions", async () => {
  const database = createSqliteDb(":memory:")
  const first = new Federation({ database, admin_provisioning: INITIAL_ADMIN })
  await first.health()
  const old_login = await login(first, "admin_initial", "test-admin-password")
  assert.equal(old_login.response.status, 200)

  const reset_provisioning = {
    mode: "reset",
    provision_id: "fap_reset_once",
    admin_id: "admin_recovered",
    password_hash: await create_federation_admin_password_hash("recovered-password"),
  }
  const recovered = new Federation({ database, admin_provisioning: reset_provisioning })
  await recovered.health()

  const old_session = await recovered.fetch(new Request("http://localhost/v1/federation/instruction", {
    headers: { authorization: `Bearer ${old_login.body.session_token}` },
  }))
  assert.equal(old_session.status, 401)
  assert.equal((await login(recovered, "admin_initial", "test-admin-password")).response.status, 401)
  assert.equal((await login(recovered, "admin_recovered", "recovered-password")).response.status, 200)

  const idempotent = new Federation({ database, admin_provisioning: reset_provisioning })
  await idempotent.health()
  assert.equal((await login(idempotent, "admin_recovered", "recovered-password")).response.status, 200)
})

/** 调用 Federation 管理员登录端点并解析响应。 */
async function login(federation, admin_id, password) {
  const response = await federation.fetch(new Request("http://localhost/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ admin_id, password }),
  }))
  return { response, body: await response.json() }
}
