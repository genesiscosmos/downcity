/** City 来源迁移的临时数据库验证：故障回滚、幂等、成员/登录/余额保留及未知来源不伪造。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { Database } from "../packages/implementations/databases/sqlite/bin/index.js";
import { migrate_city_sources, plan_city_source_migration } from "./migrate-city-sources.mjs";

/** 从提交中的真实旧 Organizations DDL 构造迁移输入，避免复制新实现作为预期。 */
function read_previous_organizations_ddl() {
  const source = execFileSync("git", ["show", "HEAD:packages/implementations/services/src/organizations/schema/sqlite.ts"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  return [...source.matchAll(/`(CREATE TABLE IF NOT EXISTS[\s\S]*?)`/gu)].map((match) => match[1]);
}

test("迁移失败全部回滚；重试成功保留业务事实和外键，重复执行无变更", async () => {
  const database = new Database({ filename: ":memory:" });
  const query = (sql, params = []) => database.query({ sql, params });
  try {
    for (const sql of read_previous_organizations_ddl()) await database.execute_ddl(sql);
    await query("INSERT INTO service_organizations VALUES ('private', 'Private', 'bureau', 'product', 'active', 'owner', 't', 't', '')");
    await query("INSERT INTO service_organizations VALUES ('global', 'Global', 'downtown', '', 'active', 'owner', 't', 't', '')");
    await query("INSERT INTO service_organization_memberships VALUES ('member', 'private', 'owner', 'owner', 'active', 't', 't', '', '')");
    await query("INSERT INTO service_organization_join_requests VALUES ('request', 'private', 'applicant', 'pending', 't', '', '')");
    await query("CREATE TABLE async_jobs (job_id TEXT PRIMARY KEY, bureau_id TEXT, user_id TEXT, result_json TEXT)");
    await query("INSERT INTO async_jobs VALUES ('job', 'product', 'owner', '{\"ok\":true}')");
    await query("CREATE TABLE service_feedback_messages (feedback_id TEXT PRIMARY KEY, bureau_id TEXT NOT NULL, user_id TEXT NOT NULL)");
    await query("INSERT INTO service_feedback_messages VALUES ('feedback', 'product', 'owner')");
    await query("CREATE TABLE service_accounts_login_flows_v4 (login_id TEXT PRIMARY KEY, bureau_id TEXT NOT NULL, phase TEXT, code_challenge TEXT)");
    await query("INSERT INTO service_accounts_login_flows_v4 VALUES ('flow', 'product', 'authorizing', 'challenge')");
    await query("CREATE TABLE downtown_bureaus (bureau_id TEXT PRIMARY KEY)");
    await query("INSERT INTO downtown_bureaus VALUES ('product')");
    await query("CREATE TABLE credits_probe (user_id TEXT PRIMARY KEY, balance INTEGER, key_fact TEXT)");
    await query("INSERT INTO credits_probe VALUES ('owner', 123, 'unchanged')");
    await query("CREATE TABLE service_ai_settlement_jobs (usage_id TEXT PRIMARY KEY, payload_json TEXT, lease_token TEXT)");
    const pending_payload = JSON.stringify({ record: { usage_id: "usage_pending", bureau_id: "product", user_id: "owner" }, charge: { idempotency_key: "ai:usage_pending", credits: 42 } });
    await query("INSERT INTO service_ai_settlement_jobs VALUES (?, ?, ?)", ["usage_pending", pending_payload, "lease_unchanged"]);
    const plan = await plan_city_source_migration(database);
    await assert.rejects(database.atomic([...plan, { sql: "INSERT INTO missing_migration_table VALUES (1)", params: [] }]));
    assert.equal((await query("SELECT scope_bureau_id FROM service_organizations WHERE organization_id='private'")).rows[0].scope_bureau_id, "product");
    assert.equal((await query("SELECT bureau_id FROM async_jobs")).rows[0].bureau_id, "product");
    assert.equal(await migrate_city_sources(database), true);
    assert.deepEqual((await query("SELECT organization_id, join_policy FROM service_organizations ORDER BY organization_id")).rows, [{ organization_id: "global", join_policy: "approval" }, { organization_id: "private", join_policy: "closed" }]);
    assert.equal((await query("SELECT * FROM service_organization_memberships")).rows[0].user_id, "owner");
    assert.equal((await query("SELECT * FROM service_organization_join_requests")).rows[0].state, "pending");
    assert.deepEqual((await query("PRAGMA foreign_key_check")).rows, []);
    assert.deepEqual((await query("SELECT * FROM async_jobs")).rows, [{ job_id: "job", user_id: "owner", result_json: '{"ok":true}', city_id: null }]);
    assert.equal((await query("SELECT city_id FROM service_feedback_messages")).rows[0].city_id, null);
    assert.deepEqual((await query("SELECT * FROM service_accounts_login_flows_v4")).rows, [{ login_id: "flow", phase: "authorizing", code_challenge: "challenge" }]);
    assert.equal((await query("SELECT * FROM archived_20261111_downtown_bureaus")).rows[0].bureau_id, "product");
    assert.equal((await query("SELECT * FROM downcity_legacy_source_facts WHERE table_name='async_jobs'")).rows[0].bureau_id, "product");
    assert.deepEqual((await query("SELECT * FROM credits_probe")).rows, [{ user_id: "owner", balance: 123, key_fact: "unchanged" }]);
    const pending = (await query("SELECT * FROM service_ai_settlement_jobs")).rows[0];
    const recovered_payload = JSON.parse(pending.payload_json);
    assert.equal(pending.lease_token, "lease_unchanged");
    assert.equal(recovered_payload.record.city_id, null);
    assert.equal("bureau_id" in recovered_payload.record, false);
    assert.deepEqual(recovered_payload.charge, { idempotency_key: "ai:usage_pending", credits: 42 });
    assert.equal((await query("SELECT payload_json FROM downcity_legacy_settlement_payloads")).rows[0].payload_json, pending_payload);
    assert.equal(await migrate_city_sources(database), false);
  } finally { await database.dispose(); }
});
