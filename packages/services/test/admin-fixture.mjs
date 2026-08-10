/**
 * Services 集成测试共用的 Federation 管理员会话 fixture。
 *
 * 管理接口使用短期 Session Token，不再使用历史环境变量中的管理员密钥。
 */

import assert from "node:assert/strict"

const test_admin_id = "admin_test"
const test_admin_password = "test-admin-password"
const test_admin_password_hash = "pbkdf2_sha256$210000$m-wik-AJwXBqFD5AAqctMWDFqQioRh2_$tM1r37AT7NvKTiQyFePgpR7K9EC5tZ487xCV_MZQEtE"

/** 为测试 Federation 初始化固定管理员，并返回登录后的 Session Token。 */
export async function create_test_admin_session(federation) {
  const administrator_table = await federation.table("federation_administrators")
  const existing = await administrator_table.select({ owner_slot: "owner" })
  if (existing.length === 0) {
    const now = new Date().toISOString()
    await administrator_table.insert({
      owner_slot: "owner",
      admin_id: test_admin_id,
      password_hash: test_admin_password_hash,
      status: "active",
      failed_attempts: "0",
      locked_until: "",
      provision_id: "services_test_initial",
      created_at: now,
      updated_at: now,
    })
  }

  const response = await federation.fetch(new Request("http://localhost/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ admin_id: test_admin_id, password: test_admin_password }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(typeof body.session_token, "string")
  return body.session_token
}
