/** Federation 管理员测试 fixture。 */

import { Federation } from "../bin/legacy.js"

const TEST_ADMIN_ID = "admin_test"
const TEST_ADMIN_PASSWORD = "test-admin-password"
const TEST_ADMIN_PASSWORD_HASH = "pbkdf2_sha256$210000$m-wik-AJwXBqFD5AAqctMWDFqQioRh2_$tM1r37AT7NvKTiQyFePgpR7K9EC5tZ487xCV_MZQEtE"

/** 创建由测试部署器直接写入固定管理员记录的 Federation。 */
export function create_test_federation(options) {
  const federation = new Federation(options)
  const original_health = federation.health.bind(federation)
  let administrator_ready = false
  federation.health = async () => {
    const result = await original_health()
    if (!administrator_ready) {
      await initialize_test_administrator(federation)
      administrator_ready = true
    }
    return result
  }
  return federation
}

/** 模拟部署控制面直接初始化管理员数据库。 */
async function initialize_test_administrator(federation) {
  const table = await federation.table("federation_administrators")
  if ((await table.select({ owner_slot: "owner" })).length > 0) return
  const now = new Date().toISOString()
  await table.insert({
    owner_slot: "owner",
    admin_id: TEST_ADMIN_ID,
    password_hash: TEST_ADMIN_PASSWORD_HASH,
    status: "active",
    failed_attempts: "0",
    locked_until: "",
    provision_id: "fap_test_initial",
    created_at: now,
    updated_at: now,
  })
}

/** 登录固定测试管理员并返回 Session Token。 */
export async function create_test_admin_session(federation) {
  const response = await federation.fetch(new Request("http://localhost/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ admin_id: TEST_ADMIN_ID, password: TEST_ADMIN_PASSWORD }),
  }))
  if (!response.ok) throw new Error(`Test administrator login failed: ${response.status}`)
  const body = await response.json()
  return body.session_token
}
