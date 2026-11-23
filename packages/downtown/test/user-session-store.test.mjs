/** 设备会话集成回归：覆盖数字及 PostgreSQL BIGINT 字符串的签发、轮换、撤销与过期。 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { create_test_downtown } from "./admin-fixture.mjs"
import { createSqliteDb } from "./sqlite-db.mjs"

/** 保留真实 SQL 存取，仅将会话数值转为 postgres-js 默认的 BIGINT 字符串。 */
function create_session_database(string_values) {
  const database = createSqliteDb(":memory:")
  const query = database.query.bind(database)
  database.query = async (statement) => {
    const result = await query(statement)
    if (!string_values || !statement.sql.includes("downtown_user_sessions")) return result
    return { ...result, rows: result.rows.map((row) => ({
      ...row, revoked: String(row.revoked), expires_at: String(row.expires_at),
    })) }
  }
  return database
}

/** 经公开 HTTP 认证入口检查设备会话 Token，覆盖真实签名与撤销判断。 */
function token_status(downtown, user_token) {
  return downtown.fetch(new Request("http://localhost/v1/downtown/token", {
    headers: { authorization: `Bearer ${user_token}` },
  })).then((response) => response.status)
}

for (const string_values of [false, true]) {
  const dialect = string_values ? "PostgreSQL BIGINT 字符串" : "SQLite 数字"
  test(`${dialect}：设备会话可签发、认证、幂等轮换并撤销`, async () => {
    const downtown = create_test_downtown({ database: create_session_database(string_values) })
    try {
      await downtown.ready()
      const authority = await downtown.runtime.get_authenticator()
      const issued = await authority.createToken({ user_id: "session-test-user", ttl: "1h" })
      const credentials = await authority.user_sessions.create(issued.user_token, randomUUID())
      assert.ok(Number.isFinite(Date.parse(credentials.refresh_expires_at)))
      assert.equal(await token_status(downtown, credentials.user_token), 200)

      const refresh_id = randomUUID()
      const renewed = await authority.user_sessions.refresh(credentials.refresh_token, refresh_id)
      assert.equal(renewed.session_id, credentials.session_id)
      assert.notEqual(renewed.refresh_token, credentials.refresh_token)
      assert.equal(await token_status(downtown, renewed.user_token), 200)
      assert.deepEqual(await authority.user_sessions.refresh(credentials.refresh_token, refresh_id), renewed)
      await assert.rejects(authority.user_sessions.refresh(credentials.refresh_token, randomUUID()),
        (error) => error.statusCode === 401)

      await authority.user_sessions.revoke(renewed.refresh_token)
      assert.equal(await token_status(downtown, renewed.user_token), 401)
      await assert.rejects(authority.user_sessions.refresh(renewed.refresh_token, randomUUID()),
        (error) => error.statusCode === 401)
    } finally { await downtown.dispose() }
  })

  test(`${dialect}：已过期设备会话拒绝访问和续期`, async () => {
    const database = create_session_database(string_values)
    const downtown = create_test_downtown({ database })
    try {
      await downtown.ready()
      const authority = await downtown.runtime.get_authenticator()
      const issued = await authority.createToken({ user_id: "session-test-user", ttl: "1h" })
      const credentials = await authority.user_sessions.create(issued.user_token, randomUUID())
      await database.query({
        sql: "UPDATE downtown_user_sessions SET expires_at = ? WHERE session_id = ?",
        params: [Date.now() - 1, credentials.session_id],
      })
      assert.equal(await token_status(downtown, credentials.user_token), 401)
      await assert.rejects(authority.user_sessions.refresh(credentials.refresh_token, randomUUID()),
        (error) => error.statusCode === 401)
    } finally { await downtown.dispose() }
  })
}
