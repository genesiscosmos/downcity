/**
 * v10 离线恢复的真实临时库回归：显式策略、逐条审计、稳定快照及检查点、
 * 发布/恢复重入与业务写入保护。测试只使用私有临时根，不读取用户数据。
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync as spawn_sync } from "node:child_process";
import { fileURLToPath as file_url_to_path } from "node:url";
import { load_runtime } from "./lib/session-v10-runtime.mjs";
import { load_runtime as load_historical } from "./lib/session-v9-runtime.mjs";
import { plan_batch, preflight, migrate, verify_batch, restore_batch, read_manifest } from "./lib/session-v10-migration.mjs";
import { fingerprint_file } from "./lib/session-v9-database.mjs";
import { digest } from "./lib/session-v7-database.mjs";
import { recovery_policy } from "./lib/session-v10-recovery.mjs";
import { parse_arguments } from "./migrate-session-sqlite-v10.mjs";

const runtime = await load_runtime(true);
const historical = await load_historical();

/** 构造有原始结果、固定快照和稳定检查点的 v9 源根，测试结束后统一释放。 */
function fixture(context, transform = content => content) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v10-reviewed-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root_path = path.join(directory, "root"); const batch_path = path.join(directory, "batch");
  const agent_path = path.join(root_path, "agents", "writer"); fs.mkdirSync(agent_path, { recursive: true });
  const database_path = path.join(agent_path, "sessions.db"); const session_id = random_uuid();
  const marker = { format_version: 9, state: "ready", migration_id: random_uuid() };
  fs.writeFileSync(path.join(root_path, "session-storage.json"), JSON.stringify(marker));
  const database = new DatabaseSync(database_path);
  try {
    database.exec(historical.AGENT_SESSION_SCHEMA_SQL);
    database.prepare("INSERT INTO storage_metadata VALUES(1,'writer',9,?,?,1,NULL)").run(random_uuid(), random_bytes(32));
    database.prepare("INSERT INTO sessions(session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(?,'work',?,'UTC',1,1,1)")
      .run(session_id, JSON.stringify({ category: "work", type: "work" }));
    database.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,'m',1,'agent','done',1,1)");
    const make_terminal = (part_id, output) => {
      const part = { part_id, state: "completed", output };
      const result_ref = runtime.create_result_ref({ session_id, category: "work", message_id: "m", message_sequence: 1, part_id }, runtime.tool_result_value(part));
      return { ...part, result_ref, disclosure_version: 1, model_output: runtime.disclose_result(runtime.tool_result_value(part), result_ref, "completed") };
    };
    const contents = [
      make_terminal("saved", null),
      { part_id: "missing", state: "completed", output: { message: "原始结果", literal: "user text stays unchanged" } },
      { ...make_terminal("oversized", "多字节😀\"\\\n".repeat(5000)), model_output: "x".repeat(17_000) },
      { part_id: "failed", state: "failed", error: "interrupted", output: { data_base64: "A".repeat(60_000), note: "keep text" } },
    ];
    const insert = database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(1,?,'m',?,'tool',?,1,1)");
    for (const [index, value] of contents.entries()) {
      const { part_id, ...content } = transform({ ...value, tool_call_id: value.part_id, tool_name: "read" }, runtime);
      insert.run(part_id, index + 1, JSON.stringify(content));
    }
    database.exec("UPDATE messages SET stable_part_sequence=4; INSERT INTO composer_checkpoints VALUES(1,'ns','before','m',1,1,'earlier summary',1,1); INSERT INTO composer_checkpoints VALUES(1,'ns','after','m',1,4,'affected summary',1,1)");
  } finally { database.close(); }
  const attachment_path = path.join(agent_path, "session-files", session_id, "attachments", "keep.txt");
  fs.mkdirSync(path.dirname(attachment_path), { recursive: true }); fs.writeFileSync(attachment_path, "unchanged attachment");
  return { root_path, batch_path, database_path, session_id, marker, attachment_path };
}

/** 读取原始存储行，用于逐字验证原始字段、稳定水位和已合法快照。 */
function read_rows(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    return { parts: database.prepare("SELECT * FROM message_parts ORDER BY sequence").all(),
      messages: database.prepare("SELECT * FROM messages").all(),
      sessions: database.prepare("SELECT * FROM sessions").all(),
      checkpoints: database.prepare("SELECT * FROM composer_checkpoints ORDER BY checkpoint_id").all() };
  } finally { database.close(); }
}

test("恢复模式只在预检及 apply 显式选择，默认严格预检仍阻断且不写源", context => {
  const input = fixture(context); const before = fingerprint_file(input.database_path);
  assert.equal(preflight(input.root_path, runtime, historical).status, "blocked");
  assert.equal(fingerprint_file(input.database_path), before);
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical, true);
  assert.equal(plan.status, "planned"); assert.equal(plan.terminal_policy, recovery_policy);
  assert.equal(plan.agents[0].tools.filter(tool => tool.evidence === "migration-rebuilt-snapshot").length, 3);
  assert.equal(plan.agents[0].cleared_checkpoints.length, 1);
  assert.equal(plan.agents[0].cleared_checkpoints[0].checkpoint_id, "after");
  assert.equal(fs.existsSync(path.join(input.batch_path, "original")), false);
  assert.equal(fingerprint_file(input.database_path), before);
  assert.equal(fs.statSync(path.join(input.batch_path, "manifest.json")).mode & 0o077, 0);
  assert.equal(parse_arguments(["--preflight", "--root", input.root_path, "--recover-reviewed"]).recover_reviewed, true);
  assert.throws(() => parse_arguments(["--status", "--root", input.root_path, "--batch", input.batch_path, "--recover-reviewed"]), /recovery_only/);
});

test("恢复后通过正式 runtime；原始结果、合法快照、稳定水位和附件保持，受影响检查点失效", async context => {
  const input = fixture(context); const before = read_rows(input.database_path); const original = fingerprint_file(input.database_path);
  const attachment = fs.statSync(input.attachment_path);
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical, true);
  await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical), /confirmation_mismatch/);
  await migrate(input.root_path, input.batch_path, runtime, historical, true);
  await runtime.assert_session_storage_ready(input.root_path);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
  assert.equal((await migrate(input.root_path, input.batch_path, runtime, historical, true)).status, "verified");
  const after = read_rows(input.database_path);
  assert.deepEqual(after.parts[0], before.parts[0]);
  assert.deepEqual(after.messages, before.messages); assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.checkpoints, before.checkpoints.filter(row => row.checkpoint_id === "before"));
  for (const [index, row] of after.parts.entries()) {
    const content = JSON.parse(row.content); const source = JSON.parse(before.parts[index].content);
    assert.deepEqual(content.output, source.output); assert.equal(content.error, source.error);
    runtime.assert_tool_terminal({ ...content, part_id: row.part_id });
    if (index) {
      const audit = plan.agents[0].tools.find(tool => tool.part_id === row.part_id);
      assert.equal(audit.target_content_sha256, digest(row.content));
      assert.equal(audit.source_content_sha256, digest(before.parts[index].content));
      assert.ok(runtime.result_bytes(content.model_output) <= runtime.RESULT_BYTES);
    }
  }
  assert.ok(!JSON.stringify(JSON.parse(after.parts[3].content).model_output).includes("A".repeat(100)));
  assert.equal(fs.statSync(input.attachment_path).ino, attachment.ino);
  assert.equal(fs.statSync(input.attachment_path).mtimeMs, attachment.mtimeMs);
  const database = new DatabaseSync(input.database_path);
  assert.throws(() => database.exec("UPDATE message_parts SET content='{}' WHERE part_id='missing'"), /stable Part content/);
  database.close();
  restore_batch(input.root_path, input.batch_path, runtime, historical);
  assert.equal(fingerprint_file(input.database_path), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime, historical).status, "restored");
});

test("未知版本、已有引用冲突、缺少原始结果及错误快照来源继续阻断", async context => {
  for (const [reason, transform] of [
    ["tool_disclosure_version_unsupported", content => content.part_id === "missing" ? { ...content, disclosure_version: 99 } : content],
    ["tool_terminal_result_ref_conflict", content => content.part_id === "oversized" ? { ...content, output: "changed" } : content],
    ["tool_recovery_result_missing", content => { if (content.part_id === "missing") delete content.output; return content; }],
    ["tool_terminal_model_view_conflict", content => content.part_id === "oversized" ? { ...content,
      model_output: { view: "folded_result", status: "failed", result_ref: content.result_ref, preview: "x".repeat(17_000) } } : content],
    ["result_ref_invalid", content => content.part_id === "oversized" ? { ...content,
      model_output: { result_ref: "res_1_invalid_saved_reference", preview: "x".repeat(17_000) } } : content],
    ["tool_terminal_location_conflict", (content, current) => content.part_id === "oversized" ? { ...content,
      result_ref: current.create_result_ref({ ...current.parse_result_ref(content.result_ref), message_id: "wrong" }, current.tool_result_value(content)) } : content],
  ]) {
    const input = fixture(context, transform); const source = fingerprint_file(input.database_path);
    const plan = plan_batch(input.root_path, input.batch_path, runtime, historical, true);
    assert.equal(plan.status, "blocked"); assert.ok(plan.blockers.some(blocker => blocker.reason === reason));
    await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical, true), /unproven/);
    assert.equal(fingerprint_file(input.database_path), source); assert.equal(fs.existsSync(path.join(input.batch_path, "original")), false);
  }
});

test("审阅后原始结果变化或清单变化均拒绝；业务写入后不能覆盖恢复", async context => {
  const changed = fixture(context); plan_batch(changed.root_path, changed.batch_path, runtime, historical, true);
  const database = new DatabaseSync(changed.database_path); database.exec("UPDATE sessions SET title='changed'"); database.close();
  await assert.rejects(migrate(changed.root_path, changed.batch_path, runtime, historical, true), /source_changed/);
  const tampered = fixture(context); const manifest = plan_batch(tampered.root_path, tampered.batch_path, runtime, historical, true);
  manifest.agents[0].tools[1].reason = "tampered";
  fs.writeFileSync(path.join(tampered.batch_path, "manifest.json"), JSON.stringify(manifest));
  assert.throws(() => read_manifest(tampered.root_path, tampered.batch_path), /batch_identity_invalid/);
  const written = fixture(context); plan_batch(written.root_path, written.batch_path, runtime, historical, true);
  await migrate(written.root_path, written.batch_path, runtime, historical, true);
  const writer = new DatabaseSync(written.database_path); writer.exec("UPDATE sessions SET title='business'"); writer.close();
  assert.throws(() => restore_batch(written.root_path, written.batch_path, runtime, historical), /business_write/);
});

test("恢复策略的发布及 restore 在 rename 成功但 ACK 丢失后复用原批次", async context => {
  for (const phase of ["publish", "restore"]) {
    const input = fixture(context); const original = fingerprint_file(input.database_path);
    plan_batch(input.root_path, input.batch_path, runtime, historical, true);
    if (phase === "restore") await migrate(input.root_path, input.batch_path, runtime, historical, true);
    const rename = fs.renameSync; let injected = false;
    fs.renameSync = (source, target) => {
      const result = rename(source, target);
      if (target === input.database_path && !injected) { injected = true; throw new Error("fixture_ack_lost"); }
      return result;
    };
    try {
      if (phase === "publish") await assert.rejects(migrate(input.root_path, input.batch_path, runtime, historical, true), /ack_lost/);
      else assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime, historical), /ack_lost/);
    } finally { fs.renameSync = rename; }
    assert.equal(injected, true);
    if (phase === "publish") await migrate(input.root_path, input.batch_path, runtime, historical, true);
    restore_batch(input.root_path, input.batch_path, runtime, historical);
    assert.equal(fingerprint_file(input.database_path), original);
  }
});

test("跨会话结果引用以原始 canonical 验证，缺快照来源一并恢复；运行态保留", async context => {
  const input = fixture(context); const source_session_id = random_uuid();
  const source_ref = runtime.create_result_ref({ session_id: source_session_id, category: "work",
    message_id: "source", message_sequence: 1, part_id: "source-part" }, null);
  const database = new DatabaseSync(input.database_path);
  try {
    database.prepare("INSERT INTO sessions(session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(?,'work',?,'UTC',2,1,1)")
      .run(source_session_id, JSON.stringify({ category: "work", type: "work" }));
    database.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(2,'source',1,'agent','done',1,1),(2,'running',2,'agent','streaming',1,1)");
    database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(2,'source-part','source',1,'tool',?,1,1)")
      .run(JSON.stringify({ tool_call_id: "s", tool_name: "read", state: "completed", output: null }));
    database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(2,'running-part','running',1,'tool',?,1,1)")
      .run(JSON.stringify({ tool_call_id: "r", tool_name: "read", state: "running" }));
    database.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(2,'lookup',3,'agent','done',1,1); UPDATE sessions SET message_count=3 WHERE session_key=2");
    database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(2,'lookup-part','lookup',1,'tool',?,1,1)")
      .run(JSON.stringify({ tool_call_id: "l", tool_name: "lookup", state: "completed", output: { result_ref: source_ref, text: "source result" } }));
  } finally { database.close(); }
  const plan = plan_batch(input.root_path, input.batch_path, runtime, historical, true);
  assert.equal(plan.status, "planned");
  assert.equal(plan.agents[0].tools.find(tool => tool.part_id === "running-part").evidence, "first-recovery-pending");
  await migrate(input.root_path, input.batch_path, runtime, historical, true);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime, historical).status, "verified");
});

test("源库未变但重建算法变化时拒绝旧计划，根标记和 canonical 保持", async context => {
  const input = fixture(context); const original = fingerprint_file(input.database_path);
  plan_batch(input.root_path, input.batch_path, runtime, historical, true);
  await assert.rejects(migrate(input.root_path, input.batch_path,
    { ...runtime, disclose_result: () => "new algorithm output" }, historical, true), /recovery_plan_changed/);
  assert.equal(fingerprint_file(input.database_path), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(input.root_path, "session-storage.json"))), input.marker);
});

test("历史调用入参中的旧引用逐值保留，正式结果字段中的旧引用仍拒绝", async context => {
  const input = fixture(context, content => ({ ...content, input: { result_ref: "res_1_historical_argument" },
    input_text: '{"result_ref":"res_1_historical_argument"}' }));
  const before = read_rows(input.database_path);
  assert.equal(plan_batch(input.root_path, input.batch_path, runtime, historical, true).status, "planned");
  await migrate(input.root_path, input.batch_path, runtime, historical, true);
  const after = read_rows(input.database_path);
  for (const [index, row] of after.parts.entries()) {
    const source = JSON.parse(before.parts[index].content); const target = JSON.parse(row.content);
    assert.deepEqual(target.input, source.input); assert.equal(target.input_text, source.input_text);
  }
  const broken = fixture(context, content => content.part_id === "missing" ? { ...content,
    output: { result_ref: "res_1_invalid_result_reference" } } : content);
  const blocked = preflight(broken.root_path, runtime, historical, true);
  assert.equal(blocked.status, "blocked"); assert.ok(blocked.blockers.some(blocker => blocker.reason === "result_ref_invalid"));
});

test("用户 CLI 完整执行恢复预检、apply、verify 和 restore", context => {
  const input = fixture(context); const original = fingerprint_file(input.database_path);
  const command_path = file_url_to_path(new URL("./migrate-session-sqlite-v10.mjs", import.meta.url));
  const invoke = (mode, arguments_ = []) => {
    const result = spawn_sync(process.execPath, [command_path, mode, "--root", input.root_path, "--batch", input.batch_path, ...arguments_], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(invoke("--preflight", ["--recover-reviewed"]).status, "planned");
  assert.equal(invoke("--apply", ["--recover-reviewed", "--writers-stopped"]).status, "ready");
  assert.equal(invoke("--verify").status, "verified");
  assert.equal(invoke("--restore", ["--writers-stopped"]).status, "restored");
  assert.equal(fingerprint_file(input.database_path), original);
});
