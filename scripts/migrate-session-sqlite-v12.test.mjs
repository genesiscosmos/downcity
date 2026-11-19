/** v12 迁移使用真实临时 SQLite 库验证无损转换、停写门禁、中断恢复及错误分类。 */
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
import { load_runtime as load_v11 } from "./lib/session-v11-runtime.mjs";
import { preflight, plan_batch, migrate, verify_batch, restore_batch, read_manifest } from "./lib/session-v12-migration.mjs";
import { fingerprint_file } from "./lib/session-v9-database.mjs";
import { file_hash, save_json } from "./lib/session-v8-files.mjs";
import { parse_arguments } from "./migrate-session-sqlite-v12.mjs";
import { export_session, load_package, package_request_hash } from "./lib/session-transfer-package.mjs";
import { convert_legacy_package } from "./lib/session-transfer-conversion.mjs";
import { digest } from "./lib/session-v7-database.mjs";

const runtime = await load_runtime();
const historical = await load_v11();

/** 创建含稳定工具、Inbox、Power、当前错误、附件、检查点和幂等收据的正式 v11 数据根。 */
function fixture(context, agent_ids = ["writer"]) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v12-test-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root_path = path.join(directory, "root"); const batch_path = path.join(directory, "batch");
  const agents = agent_ids.map(agent_id => {
    const agent_path = path.join(root_path, "agents", agent_id); fs.mkdirSync(agent_path, { recursive: true });
    const database_path = path.join(agent_path, "sessions.db"); const session_id = random_uuid();
    const database = new DatabaseSync(database_path);
    const attachment_path = path.join(agent_path, "session-files", session_id, "attachments", "keep.txt");
    fs.mkdirSync(path.dirname(attachment_path), { recursive: true }); fs.writeFileSync(attachment_path, "inbox power 原始附件");
    save_json(path.join(path.dirname(path.dirname(attachment_path)), ".owned-attachments.json"), { format_version: 2, agent_id, session_id, files: ["keep.txt"] });
    try {
      database.exec("PRAGMA foreign_keys=ON;"); database.exec(historical.AGENT_SESSION_SCHEMA_SQL);
      database.prepare("INSERT INTO storage_metadata VALUES(1,?,11,?,?,1,2)").run(agent_id, random_uuid(), random_bytes(32));
      database.prepare("INSERT INTO sessions(session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(?,'chat',?,'UTC',2,1,2)")
        .run(session_id, JSON.stringify({ category: "chat", type: "agent" }));
      database.prepare("UPDATE agent_session_state SET main_session_id=?").run(session_id);
      database.prepare("INSERT INTO messages(session_key,message_id,turn_id,sequence,role,meta,created_at,updated_at) VALUES(1,'u','turn',1,'user',?,1,1)")
        .run(JSON.stringify({ from: { kind: "user", user_id: "local" } }));
      database.exec("INSERT INTO messages(session_key,message_id,turn_id,sequence,role,state,created_at,updated_at) VALUES(1,'a','turn',2,'agent','done',1,2)");
      const insert = database.prepare("INSERT INTO message_parts VALUES(1,?,?,?,NULL,?,?,1,2)");
      insert.run("f", "u", 1, "file", JSON.stringify({ media_type: "text/plain", url: attachment_path }));
      const output = { text: "inbox 与 power 是正文", type: "power", inbox_id: "business-value" };
      const result_ref = historical.create_result_ref({ session_id, category: "chat", message_id: "a", message_sequence: 2, part_id: "t" }, output);
      insert.run("t", "a", 1, "tool", JSON.stringify({ tool_call_id: "call", tool_name: "read", input: {}, state: "completed", output, model_output: output, disclosure_version: 1, result_ref }));
      insert.run("i", "a", 2, "inbox", JSON.stringify({ inbox_id: "stable-input-id", kind: "tool_media", content: [{ type: "text", text: "inbox/power 原文" }, { type: "file", media_type: "text/plain", url: attachment_path }], created_at: 1 }));
      insert.run("p", "a", 3, "power", JSON.stringify({ power_id: "presentation", schema_version: 1, fallback_text: "power 摘要", data: { type: "inbox", inbox_id: "business-id" } }));
      database.exec("UPDATE messages SET stable_part_sequence=3 WHERE message_id='a'; INSERT INTO composer_checkpoints VALUES(1,'default','c','a',2,3,'original summary',1,2)");
      database.prepare("INSERT INTO operation_receipts VALUES(?,?,?, ?,2)").run(random_uuid(), "a".repeat(64), session_id, JSON.stringify({ inbox_id: "receipt-value" }));
      database.prepare("INSERT INTO archive_operations VALUES(?,?,'chat',?,2,3)").run(random_uuid(), session_id, "b".repeat(64));
      database.prepare("UPDATE messages SET meta=? WHERE message_id='a'").run(JSON.stringify({ current_error: { part_id: "error", sequence: 4, type: "error", scope: "turn", code: "provider_timeout", message: "retry", recoverable: true } }));
      database.exec("PRAGMA user_version=11;");
      return { agent_id, database_path, session_id, attachment_path };
    } finally { database.close(); }
  });
  const marker = { format_version: 11, state: "ready", migration_id: random_uuid(), migration_policy: "preserve-message-envelope-v11" };
  save_json(path.join(root_path, "session-storage.json"), marker);
  return { directory, root_path, batch_path, marker, agents, ...agents[0] };
}

/** 独立捕获全部原始表，验证映射之外的字段逐字不变。 */
function business_rows(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    return Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, database.prepare(`SELECT * FROM ${name}`).all().map(row => ({ ...row }))]));
  } finally { database.close(); }
}

test("预检只读 v11，旧库门禁明确拒绝且必须显式声明停写", async context => {
  const input = fixture(context); const original = file_hash(input.database_path);
  assert.equal(runtime.AGENT_SESSION_SCHEMA_VERSION, 12);
  assert.equal(historical.AGENT_SESSION_SCHEMA_VERSION, 11);
  assert.throws(() => parse_arguments(["--apply", "--root", input.root_path, "--batch", input.batch_path]), /writers_stopped/);
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /actual_version=11.*expected_version=12/);
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical);
  assert.equal(plan.status, "planned"); assert.deepEqual(plan.agents[0].proof.renamed_parts, { inbox: 1, power: 1 });
  assert.equal(file_hash(input.database_path), original);
  assert.equal(fs.existsSync(path.join(input.batch_path, "original")), false);
  assert.equal(fs.existsSync(path.join(input.root_path, "runtimes")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(input.database_path), "session-files.lease.db")), false);
});

test("整批转换仅改变类型、输入身份键和格式版本；所有业务行、附件与稳定边界保持", async context => {
  const input = fixture(context, ["writer", "helper"]);
  const before = input.agents.map(agent => ({ rows: business_rows(agent.database_path), fingerprint: fingerprint_file(agent.database_path), attachment: fs.statSync(agent.attachment_path) }));
  plan_batch(input.root_path, input.batch_path, runtime, historical);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  await runtime.assert_session_storage_ready(input.root_path);
  for (const [index, agent] of input.agents.entries()) {
    const expected = before[index].rows;
    expected.storage_metadata[0].format_version = 12;
    const inbox = expected.message_parts.find(row => row.part_id === "i"); const content = JSON.parse(inbox.content);
    inbox.type = "input"; inbox.content = JSON.stringify({ input_id: content.inbox_id, kind: content.kind, content: content.content, created_at: content.created_at });
    expected.message_parts.find(row => row.part_id === "p").type = "view";
    assert.deepEqual(business_rows(agent.database_path), expected);
    assert.equal(fs.statSync(agent.attachment_path).ino, before[index].attachment.ino);
    assert.equal(fs.statSync(agent.attachment_path).mtimeMs, before[index].attachment.mtimeMs);
    const database = new DatabaseSync(agent.database_path);
    try {
      assert.throws(() => database.exec("UPDATE message_parts SET content='{}' WHERE part_id='i'"), /stable Part content/);
      assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally { database.close(); }
  }
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
  assert.equal((await migrate(input.root_path, input.batch_path, runtime, historical)).status, "verified");
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime, historical).status, "restored");
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), before[index].fingerprint);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
});

test("v12 数据库可写新 view/input，拒绝旧类型及重复输入身份", async context => {
  const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  const database = new DatabaseSync(input.database_path);
  try {
    database.exec("PRAGMA foreign_keys=ON; INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,'new',3,'agent','done',3,3)");
    const insert = database.prepare("INSERT INTO message_parts VALUES(1,?,'new',?,NULL,?,?,3,3)");
    insert.run("new-view", 1, "view", JSON.stringify({ power_id: "presentation", schema_version: 1, fallback_text: "new", data: {} }));
    insert.run("new-input", 2, "input", JSON.stringify({ input_id: "new-id", kind: "task", content: [], created_at: 3 }));
    assert.throws(() => insert.run("old", 3, "power", "{}"), /CHECK constraint/);
    assert.throws(() => insert.run("old", 3, "inbox", "{}"), /CHECK constraint/);
    assert.throws(() => insert.run("duplicate", 3, "input", JSON.stringify({ input_id: "new-id" })), /UNIQUE constraint/);
    assert.throws(() => insert.run("invalid", 3, "input", "{}"), /CHECK constraint/);
  } finally { database.close(); }
});

test("源或计划变化、异常 DDL 在发布前阻断", async context => {
  const input = fixture(context); const plan = plan_batch(input.root_path, input.batch_path, runtime, historical);
  plan.agents[0].proof.messages++;
  save_json(path.join(input.batch_path, "manifest.json"), plan, true);
  assert.throws(() => read_manifest(input.root_path, input.batch_path), /batch_identity_invalid/);
  const changed = fixture(context); plan_batch(changed.root_path, changed.batch_path, runtime, historical);
  const database = new DatabaseSync(changed.database_path); database.exec("UPDATE sessions SET title='changed'"); database.close();
  await assert.rejects(migrate(changed.root_path, changed.batch_path, runtime, historical), /source_changed/);
  const malformed = fixture(context); const broken = new DatabaseSync(malformed.database_path);
  broken.exec("CREATE TABLE extra(value TEXT)"); broken.close();
  assert.equal(preflight(malformed.root_path, runtime, historical).status, "blocked");
});

test("根与附件租约互斥，任何目标校验失败前已经备份全部源且不发布", async context => {
  const input = fixture(context, ["writer", "helper"]); const before = input.agents.map(agent => fingerprint_file(agent.database_path));
  plan_batch(input.root_path, input.batch_path, runtime, historical);
  const root_lease = runtime.RootLease.acquire_write(input.root_path);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical)); } finally { root_lease.release(); }
  const file_lease = runtime.AgentSessionFileLease.acquire(input.database_path, "writer", false, true);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical), /attachments_in_use/); } finally { file_lease.release(); }
  await assert.rejects(migrate(input.root_path, input.batch_path, { ...runtime, decode_session_message: () => { throw new Error("fixture_codec"); } }, historical));
  assert.equal(fs.readdirSync(path.join(input.batch_path, "original")).length, 2);
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), before[index]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
});

test("发布或恢复确认丢失可继续原批次，部分发布期间宿主门禁拒绝启动", async context => {
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
    await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
    if (phase === "publish") await migrate(input.root_path, input.batch_path, runtime, historical);
    restore_batch(input.root_path, input.batch_path, runtime, historical);
    assert.equal(fingerprint_file(input.database_path), original);
  }
});

test("发生业务写入或附件变化之后禁止恢复覆盖", async context => {
  for (const change of ["database", "attachment"]) {
    const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
    await migrate(input.root_path, input.batch_path, runtime, historical);
    if (change === "database") {
      const database = new DatabaseSync(input.database_path); database.exec("UPDATE sessions SET title='new business'"); database.close();
    } else fs.writeFileSync(input.attachment_path, "changed");
    assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime, historical), change === "database" ? /business_write/ : /attachments_changed/);
  }
});

test("schema11 单记录包显式转换为 schema12，正文和附件不变且输入附件可重绑定", async context => {
  const input = fixture(context); plan_batch(input.root_path, input.batch_path, runtime, historical);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  const package_path = path.join(input.directory, "package");
  await export_session({ root_path: input.root_path, agent_id: "writer", session_id: input.session_id, package_path, operation_id: random_uuid(), writers_stopped: true }, runtime);
  const current = load_package(package_path, runtime);
  assert.equal(current.manifest.schema_version, 12);
  assert.deepEqual(current.record.message_parts.map(part => part.type), ["tool", "input", "view", "file"]);
  const legacy_record = structuredClone(current.record);
  for (const part of legacy_record.message_parts) {
    if (part.type === "view") part.type = "power";
    if (part.type !== "input") continue;
    const { input_id, ...content } = JSON.parse(part.content);
    part.type = "inbox"; part.content = JSON.stringify({ inbox_id: input_id, ...content });
  }
  const manifest = { ...current.manifest, schema_version: 11, record_sha256: digest(legacy_record) };
  manifest.request_hash = package_request_hash(manifest);
  save_json(path.join(package_path, "record.json"), legacy_record, true); save_json(path.join(package_path, "manifest.json"), manifest, true);
  const original = file_hash(path.join(package_path, "record.json"));
  assert.throws(() => load_package(package_path, runtime), /legacy_package_requires_conversion/);
  const output_path = path.join(input.directory, "converted");
  await convert_legacy_package({ package_path, output_path, operation_id: random_uuid() }, runtime);
  assert.deepEqual(load_package(output_path, runtime).record, current.record);
  assert.equal(file_hash(path.join(package_path, "record.json")), original);
});

test("CLI 的预检、执行、验收和恢复使用同一 v12 批次", context => {
  const input = fixture(context); const command = file_url_to_path(new URL("./migrate-session-sqlite-v12.mjs", import.meta.url));
  const invoke = (...arguments_) => spawn_sync(process.execPath, [command, ...arguments_, "--root", input.root_path, "--batch", input.batch_path], { encoding: "utf8" });
  assert.equal(invoke("--apply").status, 1);
  for (const mode of ["--preflight", "--apply", "--verify", "--status", "--restore"]) {
    const result = invoke(mode, ...(["--apply", "--restore"].includes(mode) ? ["--writers-stopped"] : []));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).target_schema, 12);
  }
});
