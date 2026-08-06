/** Federation 管理员测试 fixture。 */

import { Federation } from "../bin/index.js"

const TEST_ADMIN_ID = "admin_test"
const TEST_ADMIN_PASSWORD = "test-admin-password"
const TEST_ADMIN_PASSWORD_HASH = "pbkdf2_sha256$210000$m-wik-AJwXBqFD5AAqctMWDFqQioRh2_$tM1r37AT7NvKTiQyFePgpR7K9EC5tZ487xCV_MZQEtE"

/** 创建带固定测试管理员 provisioning 的 Federation。 */
export function create_test_federation(options) {
  return new Federation({
    ...options,
    admin_provisioning: {
      mode: "initialize",
      provision_id: "fap_test_initial",
      admin_id: TEST_ADMIN_ID,
      password_hash: TEST_ADMIN_PASSWORD_HASH,
    },
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
