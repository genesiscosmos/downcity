/**
 * v11 离线迁移的真实临时库验收：完整内容保留、共享门禁、发布/恢复中断与写入保护。
 * 所有数据库、附件和 CLI 调用均位于私有临时根，不打开真实用户数据或启动宿主。
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync as spawn_sync } from "node:child_process";
import { fileURLToPath as file_url_to_path } from "node:url";
import { load_runtime } from "./lib/session-runtime.mjs";
import { load_runtime as load_v10 } from "./lib/session-v10-runtime.mjs";
import { load_runtime as load_v9 } from "./lib/session-v9-runtime.mjs";
import { load_package as load_v9_package } from "./lib/session-v9-transfer-package.mjs";
import { preflight, plan_batch, migrate, verify_batch, restore_batch, read_manifest } from "./lib/session-v11-migration.mjs";
import { fingerprint_file } from "./lib/session-v9-database.mjs";
import { save_json, file_hash } from "./lib/session-v8-files.mjs";
import { parse_arguments } from "./migrate-session-sqlite-v11.mjs";
import { export_session, load_package, load_protocol_package, package_request_hash } from "./lib/session-transfer-package.mjs";
import { convert_legacy_package } from "./lib/session-transfer-conversion.mjs";

const runtime = await load_runtime(true);
const historical = await load_v10();

/** 创建完整 v10 源、稳定 Tool、检查点、归档计划及附件，覆盖重建表的全部关系。 */
function fixture(context, agent_ids = ["writer"]) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v11-test-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root_path = path.join(directory, "root"); const batch_path = path.join(directory, "batch");
  const agents = agent_ids.map(agent_id => {
    const agent_path = path.join(root_path, "agents", agent_id); fs.mkdirSync(agent_path, { recursive: true });
    const database_path = path.join(agent_path, "sessions.db"); const session_id = random_uuid();
    const database = new DatabaseSync(database_path);
    try {
      database.exec("PRAGMA foreign_keys=ON;"); database.exec(historical.AGENT_SESSION_SCHEMA_SQL);
      database.prepare("INSERT INTO storage_metadata VALUES(1,?,10,?,?,1,2)").run(agent_id, random_uuid(), random_bytes(32));
      database.prepare("INSERT INTO sessions(session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(?,'chat',?,'UTC',2,1,2)")
        .run(session_id, JSON.stringify({ category: "chat", type: "agent" }));
      database.prepare("UPDATE agent_session_state SET main_session_id=?").run(session_id);
      database.prepare("UPDATE session_configuration SET system_snapshot='original system',model_binding=? WHERE session_key=1")
        .run(JSON.stringify({ default_model_id: null }));
      database.prepare("INSERT INTO messages(session_key,message_id,turn_id,sequence,role,meta,created_at,updated_at) VALUES(1,'u','turn',1,'user',?,1,1)")
        .run(JSON.stringify({ from: { kind: "user", user_id: "local" } }));
      database.exec("INSERT INTO messages(session_key,message_id,turn_id,sequence,role,state,created_at,updated_at) VALUES(1,'a','turn',2,'agent','done',1,2)");
      const attachment_path = path.join(agent_path, "session-files", session_id, "attachments", "keep.txt");
      fs.mkdirSync(path.dirname(attachment_path), { recursive: true }); fs.writeFileSync(attachment_path, "original attachment");
      save_json(path.join(path.dirname(path.dirname(attachment_path)), ".owned-attachments.json"), { format_version: 2, agent_id, session_id, files: ["keep.txt"] });
      database.prepare("INSERT INTO message_parts VALUES(1,'f','u',1,NULL,'file',?,1,1)").run(JSON.stringify({ media_type: "text/plain", url: attachment_path }));
      const output = { result: "原始工具结果" };
      const reference = historical.create_result_ref({ session_id, category: "chat", message_id: "a", message_sequence: 2, part_id: "t" }, output);
      database.prepare("INSERT INTO message_parts VALUES(1,'t','a',1,'step','tool',?,1,2)")
        .run(JSON.stringify({ tool_call_id: "call", tool_name: "read", input: {}, state: "completed", output, model_output: output, disclosure_version: 1, result_ref: reference }));
      database.exec("UPDATE messages SET stable_part_sequence=1 WHERE message_id='a'; INSERT INTO composer_checkpoints VALUES(1,'default','c','a',2,1,'original summary',1,2)");
      database.prepare("INSERT INTO operation_receipts VALUES(?,?,?, ?,2)").run(random_uuid(), "a".repeat(64), session_id, JSON.stringify({ preserved: true }));
      database.prepare("INSERT INTO archive_operations VALUES(?,?,'chat',?,2,3)").run(random_uuid(), session_id, "b".repeat(64));
      database.exec("PRAGMA user_version=10;");
      return { agent_id, database_path, session_id, attachment_path };
    } finally { database.close(); }
  });
  const marker = { format_version: 10, state: "ready", migration_id: random_uuid(), terminal_policy: "original-policy" };
  fs.writeFileSync(path.join(root_path, "session-storage.json"), JSON.stringify(marker));
  return { directory, root_path, batch_path, marker, agents, ...agents[0] };
}

/** 在关闭连接后返回独立原始行，逐字段比较不依赖迁移的摘要实现。 */
function business_rows(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    return Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, database.prepare(`SELECT * FROM ${name}`).all().map(row => name === "storage_metadata" ? { ...row, format_version: 11 } : row)]));
  } finally { database.close(); }
}

test("参数必须明确，历史 v10 与当前 v11 运行时独立；预检只读且不创建备份或租约", context => {
  const input = fixture(context);
  assert.throws(() => parse_arguments([]), /explicit_root/);
  assert.throws(() => parse_arguments(["--apply", "--root", input.root_path, "--batch", input.batch_path]), /writers_stopped/);
  assert.throws(() => parse_arguments(["--help", "--typo"]), /unknown_argument/);
  assert.throws(() => parse_arguments(["--preflight", "--verify", "--root", input.root_path]), /conflicting_modes/);
  const original = file_hash(input.database_path);
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical);
  assert.equal(plan.status, "planned"); assert.equal(plan.agents[0].proof.messages, 2);
  assert.equal(file_hash(input.database_path), original);
  assert.equal(fs.existsSync(path.join(input.batch_path, "original")), false);
  assert.equal(fs.existsSync(path.join(input.root_path, "runtimes")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(input.database_path), "session-files.lease.db")), false);
  assert.equal(fs.statSync(path.join(input.batch_path, "manifest.json")).mode & 0o077, 0);
  assert.throws(() => preflight(input.root_path, historical, runtime), /runtime_mismatch/);
});

test("全批保留所有业务行、附件和稳定约束；v11 两层门禁均通过，恢复回到精确 v10", async context => {
  const input = fixture(context, ["writer", "helper"]);
  const before = input.agents.map(agent => ({ rows: business_rows(agent.database_path), fingerprint: fingerprint_file(agent.database_path), attachment: fs.statSync(agent.attachment_path) }));
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /actual_version=10.*expected_version=11/);
  plan_batch(input.root_path, input.batch_path, runtime, historical);
  assert.equal((await migrate(input.root_path, input.batch_path, runtime, historical)).status, "ready");
  await runtime.assert_session_storage_ready(input.root_path);
  for (const [index, agent] of input.agents.entries()) {
    assert.deepEqual(business_rows(agent.database_path), before[index].rows);
    assert.equal(fs.statSync(agent.attachment_path).ino, before[index].attachment.ino);
    assert.equal(fs.statSync(agent.attachment_path).mtimeMs, before[index].attachment.mtimeMs);
    const database = new DatabaseSync(agent.database_path);
    try {
      runtime.assert_agent_session_schema(database, agent.agent_id);
      assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
      assert.throws(() => database.exec("UPDATE message_parts SET content='{}' WHERE part_id='t'"), /stable Part content/);
      assert.throws(() => database.exec("INSERT INTO messages VALUES(1,'bad',NULL,3,1,'agent','done',1,NULL,NULL,NULL,NULL,1,1)"), /stable prefix/);
    } finally { database.close(); }
  }
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
  assert.equal((await migrate(input.root_path, input.batch_path, runtime, historical)).status, "verified");
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime, historical).status, "restored");
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime, historical).status, "restored");
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), before[index].fingerprint);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
});

test("只改根标记仍拒绝旧单库，并报告 Agent、路径及实际/目标版本", async context => {
  const input = fixture(context);
  fs.writeFileSync(path.join(input.root_path, "session-storage.json"), JSON.stringify({ format_version: 11, state: "ready" }));
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), error => error.message.includes("agent_id=writer")
    && error.message.includes(input.database_path) && /actual_version=10.*expected_version=11/.test(error.message));
});

test("非正式 DDL、重复 UUID、源变化和篡改计划均阻断，不发布数据库", async context => {
  const malformed = fixture(context);
  const database = new DatabaseSync(malformed.database_path); database.exec("CREATE TABLE unexpected(value TEXT)"); database.close();
  assert.equal(preflight(malformed.root_path, runtime, historical).status, "blocked");
  const duplicate = fixture(context, ["writer", "helper"]);
  const helper = new DatabaseSync(duplicate.agents[1].database_path);
  helper.prepare("INSERT INTO sessions(session_id,category,origin,timezone,created_at,updated_at) VALUES(?,'work',?,'UTC',1,1)")
    .run(duplicate.session_id, JSON.stringify({ category: "work", type: "work" })); helper.close();
  assert.equal(preflight(duplicate.root_path, runtime, historical).status, "blocked");
  const changed = fixture(context); plan_batch(changed.root_path, changed.batch_path, runtime, historical);
  const writer = new DatabaseSync(changed.database_path); writer.exec("UPDATE sessions SET title='changed'"); writer.close();
  await assert.rejects(migrate(changed.root_path, changed.batch_path, runtime, historical), /source_changed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(changed.root_path, "session-storage.json"))), changed.marker);
  const tampered = fixture(context); const plan = plan_batch(tampered.root_path, tampered.batch_path, runtime, historical);
  plan.agents[0].proof.messages++;
  save_json(path.join(tampered.batch_path, "manifest.json"), plan, true);
  assert.throws(() => read_manifest(tampered.root_path, tampered.batch_path), /batch_identity_invalid/);
});

test("任一目标转换失败之前已备份全部源，业务根及标记保持；原批次可继续", async context => {
  const input = fixture(context, ["helper", "writer"]); plan_batch(input.root_path, input.batch_path, runtime, historical);
  const original = input.agents.map(agent => fingerprint_file(agent.database_path));
  await assert.rejects(migrate(input.root_path, input.batch_path, { ...runtime, decode_session_message: () => { throw new Error("fixture_codec"); } }, historical));
  assert.equal(fs.readdirSync(path.join(input.batch_path, "original")).length, 2);
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), original[index]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
  await migrate(input.root_path, input.batch_path, runtime, historical);
});

test("数据库发布或恢复后 ACK 丢失，根保持拒绝中间态，同批次可继续", async context => {
  for (const phase of ["publish", "restore"]) {
    const input = fixture(context, ["writer", "helper"]); const original = fingerprint_file(input.database_path);
    plan_batch(input.root_path, input.batch_path, runtime, historical);
    if (phase === "restore") await migrate(input.root_path, input.batch_path, runtime, historical);
    const rename = fs.renameSync; let injected = false;
    fs.renameSync = (source, target) => {
      const result = rename(source, target);
      if (target === input.database_path && !injected) { injected = true; throw new Error("fixture_ack_lost"); }
      return result;
    };
    try {
      if (phase === "publish") await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical), /ack_lost/);
      else assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime, historical), /ack_lost/);
    } finally { fs.renameSync = rename; }
    assert.equal(injected, true);
    await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
    if (phase === "publish") await migrate(input.root_path, input.batch_path, runtime, historical);
    restore_batch(input.root_path, input.batch_path, runtime, historical);
    assert.equal(fingerprint_file(input.database_path), original);
  }
});

test("后续业务写入或附件变化阻止恢复；持有根/附件租约时禁止迁移", async context => {
  const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
  const root_lease = runtime.RootLease.acquire_write(input.root_path);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical)); } finally { root_lease.release(); }
  const file_lease = runtime.AgentSessionFileLease.acquire(input.database_path, "writer", false, true);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical), /attachments_in_use/); } finally { file_lease.release(); }
  await migrate(input.root_path, input.batch_path, runtime, historical);
  const database = new DatabaseSync(input.database_path); database.exec("UPDATE sessions SET title='business write'"); database.close();
  assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime, historical), /business_write/);
  const attachment = fixture(context); plan_batch(attachment.root_path, attachment.batch_path, runtime, historical);
  await migrate(attachment.root_path, attachment.batch_path, runtime, historical);
  fs.writeFileSync(attachment.attachment_path, "changed");
  assert.throws(() => restore_batch(attachment.root_path, attachment.batch_path, runtime, historical), /attachments_changed/);
});

test("v11 current_error 可持久化并经过导出包完整验证，正文与水位不变", async context => {
  const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  const current_error = { part_id: "error", sequence: 2, type: "error", scope: "turn", code: "provider_timeout", message: "retry", recoverable: true };
  const database = new DatabaseSync(input.database_path);
  database.prepare("UPDATE messages SET meta=? WHERE message_id='a'").run(JSON.stringify({ current_error })); database.close();
  const package_path = path.join(input.directory, "package");
  await export_session({ root_path: input.root_path, agent_id: "writer", session_id: input.session_id,
    package_path, operation_id: random_uuid(), writers_stopped: true }, runtime);
  const { manifest, record } = load_package(package_path, runtime);
  assert.equal(manifest.schema_version, 11); assert.equal(manifest.format_version, 3);
  assert.deepEqual(JSON.parse(record.messages[1].meta).current_error, current_error);
  assert.equal(record.messages[1].stable_part_sequence, 1); assert.equal(record.message_parts.length, 2);
});

test("schema10/schema9 历史包必须显式转换；输出 schema11，原包逐字不变", async context => {
  for (const schema_version of [10, 9]) {
    const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
    await migrate(input.root_path, input.batch_path, runtime, historical);
    const package_path = path.join(input.directory, "package");
    await export_session({ root_path: input.root_path, agent_id: "writer", session_id: input.session_id,
      package_path, operation_id: random_uuid(), writers_stopped: true }, runtime);
    const manifest_path = path.join(package_path, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifest_path));
    manifest.schema_version = schema_version; manifest.format_version = schema_version === 10 ? 3 : 2;
    manifest.request_hash = package_request_hash(manifest); save_json(manifest_path, manifest, true);
    const before = file_hash(manifest_path);
    const original = schema_version === 10 ? load_protocol_package(package_path, historical).record : load_v9_package(package_path, await load_v9()).record;
    assert.throws(() => load_package(package_path, runtime), /legacy_package_requires_conversion/);
    const output_path = path.join(input.directory, "converted");
    await convert_legacy_package({ package_path, output_path, operation_id: random_uuid() }, runtime);
    assert.deepEqual(load_package(output_path, runtime).record, original);
    assert.equal(file_hash(manifest_path), before);
  }
});

test("真实 CLI 从预检到验收使用同一批次，默认无停写声明不能 apply", context => {
  const input = fixture(context);
  const command_path = file_url_to_path(new URL("./migrate-session-sqlite-v11.mjs", import.meta.url));
  const invoke = (...arguments_) => spawn_sync(process.execPath, [command_path, ...arguments_, "--root", input.root_path, "--batch", input.batch_path], { encoding: "utf8" });
  assert.equal(invoke("--apply").status, 1);
  for (const mode of ["--preflight", "--apply", "--verify", "--status", "--restore"]) {
    const result = invoke(mode, ...(["--apply", "--restore"].includes(mode) ? ["--writers-stopped"] : []));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).target_schema, 11);
  }
});
