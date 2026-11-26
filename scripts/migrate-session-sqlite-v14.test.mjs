/** 用真实 SQLite 验证最终 v14 重建、废弃字段删除、历史保留和批次失败恢复；只写临时数据根。 */
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
import { load_runtime as load_v13 } from "./lib/session-v13-runtime.mjs";
import { preflight, plan_batch, migrate, verify_batch, restore_batch } from "./lib/session-v14-migration.mjs";
import { convert_database } from "./lib/session-agent-variables-conversion.mjs";
import { fingerprint_file, schema_descriptor } from "./lib/session-v9-database.mjs";
import { file_hash, save_json } from "./lib/session-v8-files.mjs";

const runtime = await load_runtime(true);
const historical = await load_v13();
const old_schema = historical.AGENT_SESSION_SCHEMA_SQL.replace("  approval_mode TEXT",
  "  model_binding TEXT CHECK (model_binding IS NULL OR (json_valid(model_binding) AND json_type(model_binding) = 'object')),\n  approval_mode TEXT");

/** 独立构造两个真实 v13 来源，含非空废弃字段、稳定消息、检查点、归档记录及附件。 */
function fixture(context, variants = ["old", "final"]) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v14-test-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root_path = path.join(directory, "root");
  const batch_path = path.join(directory, "batch");
  const agents = variants.map(variant => {
    const agent_id = variant;
    const agent_path = path.join(root_path, "agents", agent_id);
    fs.mkdirSync(agent_path, { recursive: true });
    const database_path = path.join(agent_path, "sessions.db");
    const session_id = random_uuid();
    const archived_id = random_uuid();
    const attachment_path = path.join(agent_path, "session-files", session_id, "attachments", "keep.txt");
    fs.mkdirSync(path.dirname(attachment_path), { recursive: true });
    fs.writeFileSync(attachment_path, "原始附件 model_binding 仅作为正文保留");
    save_json(path.join(path.dirname(path.dirname(attachment_path)), ".owned-attachments.json"),
      { format_version: 2, agent_id, session_id, files: ["keep.txt"] });
    const database = new DatabaseSync(database_path);
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      database.exec(variant === "old" ? old_schema : historical.AGENT_SESSION_SCHEMA_SQL);
      database.prepare("INSERT INTO storage_metadata VALUES(1,?,13,?,?,1,2)").run(agent_id, random_uuid(), random_bytes(32));
      database.prepare(`INSERT INTO sessions(session_key,session_id,type,kind,timezone,title,message_count,created_at,updated_at)
        VALUES(17,?,'chat','main','Asia/Shanghai','历史会话',2,1,2)`).run(session_id);
      database.prepare(`INSERT INTO sessions(session_key,session_id,type,kind,timezone,archived,archived_at,created_at,updated_at)
        VALUES(51,?,'work','task','UTC',1,3,1,3)`).run(archived_id);
      database.exec(`UPDATE session_configuration SET approval_mode='ask',execution_profile='{"env":{"LANG":"zh_CN"}}',
        system_snapshot='原始系统指令' WHERE session_key=17`);
      if (variant === "old") {
        database.exec(`UPDATE session_configuration SET model_binding='{"provider":"retired","model":"old"}';
          UPDATE agent_session_state SET main_session_id=(SELECT session_id FROM sessions WHERE session_key=17)`);
      }
      database.exec(`INSERT INTO messages(session_key,message_id,turn_id,sequence,role,created_at,updated_at)
        VALUES(17,'u','turn',1,'user',1,1);
        INSERT INTO messages(session_key,message_id,turn_id,sequence,role,state,created_at,updated_at)
        VALUES(17,'a','turn',2,'agent','done',1,2)`);
      const insert = database.prepare("INSERT INTO message_parts VALUES(17,?,?,?,NULL,?,?,1,2)");
      insert.run("text", "u", 1, "text", '{"text":"model_binding 正文字节不改"}');
      insert.run("file", "u", 2, "file", JSON.stringify({ media_type: "text/plain", url: attachment_path }));
      insert.run("reply", "a", 1, "text", '{"text":"原始回复","state":"done"}');
      database.exec(`UPDATE messages SET stable_part_sequence=1 WHERE message_id='a';
        INSERT INTO composer_checkpoints VALUES(17,'default','checkpoint','a',2,1,'原始摘要',1,2)`);
      database.prepare("INSERT INTO session_creation_keys VALUES('chat','main',?)").run(session_id);
      const retired_id = random_uuid();
      database.prepare("INSERT INTO retired_session_ids VALUES(?,3)").run(retired_id);
      database.prepare("INSERT INTO attachment_cleanup VALUES(?,3,2)").run(retired_id);
      database.prepare("INSERT INTO legacy_operation_ids VALUES(?,12,?)").run(random_uuid(), "a".repeat(64));
      database.prepare("INSERT INTO operation_receipts VALUES(?,?,?,'{\"ok\":true}',2)")
        .run(random_uuid(), "b".repeat(64), session_id);
      const operation_id = random_uuid();
      database.prepare("INSERT INTO archive_operations VALUES(?,?,'work',?,2,3)").run(operation_id, archived_id, "c".repeat(64));
      database.prepare("INSERT INTO archive_operation_nodes VALUES(?,1,?,'work','task',NULL,3)").run(operation_id, archived_id);
      database.exec("PRAGMA user_version=13;");
    } finally { database.close(); }
    return { agent_id, database_path, session_id, attachment_path };
  });
  const marker = { format_version: 13, state: "ready", migration_id: random_uuid(), migration_policy: "session-flat-v13" };
  save_json(path.join(root_path, "session-storage.json"), marker);
  return { directory, root_path, batch_path, marker, agents, ...agents[0] };
}

/** 独立读取所有业务表，用逐字段比较避免只依赖转换器自己的摘要。 */
function business_rows(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    return Object.fromEntries(schema_descriptor(database).filter(item => item.type === "table").map(({ name }) =>
      [name, database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => ({ ...row }))]));
  } finally { database.close(); }
}

test("两种 v13 来源统一重建最终 v14，删除旧字段且全部业务与附件保持，原批次可以恢复", async context => {
  const input = fixture(context);
  const before = input.agents.map(agent => ({ rows: business_rows(agent.database_path),
    hash: file_hash(agent.database_path), fingerprint: fingerprint_file(agent.database_path), attachment: fs.statSync(agent.attachment_path) }));
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical);
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.blockers, []);
  for (const [index, agent] of input.agents.entries()) assert.equal(file_hash(agent.database_path), before[index].hash);
  assert.equal(fs.existsSync(path.join(input.batch_path, "original")), false);
  assert.equal(fs.existsSync(path.join(input.root_path, "runtimes")), false);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  await runtime.assert_session_storage_ready(input.root_path);
  const expected_database = new DatabaseSync(":memory:");
  try {
    expected_database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    for (const [index, agent] of input.agents.entries()) {
      const expected = before[index].rows;
      delete expected.agent_session_state;
      expected.agent_variables = agent.agent_id === "old" ? [{ key: "desktop.main_chatroom", value: JSON.stringify(agent.session_id) }] : [];
      expected.storage_metadata[0].format_version = 14;
      for (const row of expected.session_configuration) delete row.model_binding;
      assert.deepEqual(business_rows(agent.database_path), expected);
      const database = new DatabaseSync(agent.database_path);
      try {
        assert.deepEqual(schema_descriptor(database), schema_descriptor(expected_database));
        assert.equal(database.prepare("PRAGMA user_version").get().user_version, 14);
        assert.equal(database.prepare("PRAGMA table_info(session_configuration)").all().some(row => row.name === "model_binding"), false);
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
        assert.throws(() => database.exec("UPDATE message_parts SET content='{}' WHERE part_id='reply'"), /stable Part content/);
        assert.throws(() => database.exec("UPDATE session_configuration SET model_binding=NULL"), /no such column/);
      } finally { database.close(); }
      assert.equal(fs.statSync(agent.database_path).mode & 0o777, 0o600);
      const attachment = fs.statSync(agent.attachment_path);
      assert.equal(attachment.ino, before[index].attachment.ino);
      assert.equal(attachment.mtimeMs, before[index].attachment.mtimeMs);
    }
  } finally { expected_database.close(); }
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
  assert.equal((await migrate(input.root_path, input.batch_path, runtime, historical)).status, "verified");
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime, historical).status, "restored");
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), before[index].fingerprint);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
});

test("未知表、未知字段、缺失触发器或旧字段约束变化都不能被当作已知 v13", context => {
  for (const mutation of ["CREATE TABLE extra(value TEXT)", "ALTER TABLE session_configuration ADD COLUMN extra TEXT",
    "DROP TRIGGER messages_identity_immutable", "ALTER TABLE session_configuration DROP COLUMN model_binding; ALTER TABLE session_configuration ADD COLUMN model_binding TEXT"]) {
    const input = fixture(context, ["old"]);
    const database = new DatabaseSync(input.database_path);
    try { database.exec(mutation); } finally { database.close(); }
    const before = file_hash(input.database_path);
    const result = preflight(input.root_path, runtime, historical);
    assert.equal(result.status, "blocked", mutation);
    assert.equal(result.blockers[0].reason, "session_protocol_schema_mismatch");
    assert.equal(file_hash(input.database_path), before);
  }
});

test("无效消息、外键或主房间指针在预检时拒绝", context => {
  for (const [mutation, reason] of [["UPDATE message_parts SET content='{}' WHERE part_id='text'", "session_variables_message_codec_rejected"],
    ["PRAGMA foreign_keys=OFF; INSERT INTO session_configuration(session_key) VALUES(999)", "foreign_key_check_failed"],
    ["UPDATE agent_session_state SET main_session_id=(SELECT session_id FROM sessions WHERE session_key=51)", "source_main_pointer_invalid"]]) {
    const input = fixture(context, ["old"]);
    const database = new DatabaseSync(input.database_path);
    try {
      // 暂时移除写入门禁后恢复原定义，保证预检失败来自数据本身而非 schema 差异。
      const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name='agent_session_state_valid_update'").get().sql;
      database.exec("DROP TRIGGER agent_session_state_valid_update");
      database.exec(mutation);
      database.exec(trigger);
    } finally { database.close(); }
    const result = preflight(input.root_path, runtime, historical);
    assert.equal(result.status, "blocked");
    assert.equal(result.blockers[0].reason, reason);
  }
});

test("暂存验收失败时全部源已备份但均不发布，可继续同一批次", async context => {
  const input = fixture(context);
  const before = input.agents.map(agent => fingerprint_file(agent.database_path));
  plan_batch(input.root_path, input.batch_path, runtime, historical);
  await assert.rejects(migrate(input.root_path, input.batch_path,
    { ...runtime, decode_session_message() { throw new Error("fixture_codec_rejected"); } }, historical), /session_variables_message_codec_rejected/);
  assert.equal(fs.readdirSync(path.join(input.batch_path, "original")).length, 2);
  for (const [index, agent] of input.agents.entries()) assert.equal(fingerprint_file(agent.database_path), before[index]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
  await migrate(input.root_path, input.batch_path, runtime, historical);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
});

test("预检后的源变化和既有输出不能被转换覆盖", async context => {
  const input = fixture(context, ["old"]);
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical);
  const target_path = path.join(input.directory, "existing.db");
  fs.writeFileSync(target_path, "must retain");
  await assert.rejects(convert_database(input.database_path, target_path, input.agent_id, historical, runtime, plan.agents[0].proof), /conversion_target_already_exists/);
  assert.equal(fs.readFileSync(target_path, "utf8"), "must retain");
  const database = new DatabaseSync(input.database_path);
  try { database.exec("UPDATE sessions SET title='new business'"); } finally { database.close(); }
  await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical), /source_changed/);
  assert.equal(business_rows(input.database_path).storage_metadata[0].format_version, 13);
});

test("CLI 完整走通预检、执行、验收和恢复，执行必须声明停写", context => {
  const input = fixture(context);
  const command = file_url_to_path(new URL("./migrate-session-sqlite-v14.mjs", import.meta.url));
  const invoke = (...arguments_) => spawn_sync(process.execPath,
    [command, ...arguments_, "--root", input.root_path, "--batch", input.batch_path], { encoding: "utf8" });
  assert.equal(invoke("--apply").status, 1);
  for (const mode of ["--preflight", "--apply", "--verify", "--status", "--restore"]) {
    const result = invoke(mode, ...(["--apply", "--restore"].includes(mode) ? ["--writers-stopped"] : []));
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.blockers, []);
    assert.equal(report.databases, 2);
    assert.equal(report.messages, 4);
  }
});
