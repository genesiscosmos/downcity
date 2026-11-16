/** v9 离线转换的真实临时根回归：消息、附件、外部引用、恢复和拒绝业务写入后的回退。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID as random_uuid, randomBytes as random_bytes, createHash as create_hash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { load_runtime } from "./lib/session-v9-runtime.mjs";
import { v8_schema, fingerprint_file, open_source } from "./lib/session-v9-database.mjs";
import { preflight, migrate, verify_batch, restore_batch, read_manifest } from "./lib/session-v9-migration.mjs";
import { parse_arguments } from "./migrate-session-sqlite-v9.mjs";
import { create_resolver, identity_policy, identity_rows } from "./lib/session-v9-identities.mjs";
import { rewrite_completion } from "./lib/session-v9-references.mjs";
import { create_result_rewriter } from "./lib/session-v9-results.mjs";

const runtime = await load_runtime(true);
const hash_text = value => create_hash("sha256").update(value).digest("hex");

/** 全部业务数据只落在测试私有临时目录中。 */
function fixture(context) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v9-test-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root"); const batch = path.join(directory, "batch");
  const agent_path = path.join(root, "agents", "writer"); fs.mkdirSync(agent_path, { recursive: true });
  const database_path = path.join(agent_path, "sessions.db");
  const database = new DatabaseSync(database_path);
  database.exec(v8_schema);
  database.prepare("INSERT INTO storage_metadata(singleton_id,agent_id,format_version,generation,cursor_secret,created_at) VALUES(1,'writer',8,?,?,1)")
    .run(random_uuid(), random_bytes(32));
  const storage_id = random_uuid(); const work_storage_id = random_uuid();
  const insert = database.prepare("INSERT INTO sessions(session_key,storage_id,session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(?,?,?,?,?,'UTC',0,1,1)");
  insert.run(1, storage_id, "writer", "chat", JSON.stringify({ category: "chat", type: "agent" }));
  insert.run(2, work_storage_id, "old-work", "work", JSON.stringify({ category: "work", type: "work", parent_agent_id: "writer", parent_session_id: "writer", parent_session_category: "chat", delegation_depth: 1 }));
  database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,meta,created_at,updated_at) VALUES(1,'user',1,'user',NULL,?,1,1)")
    .run(JSON.stringify({ from: { kind: "user", user_id: "local" } }));
  const record_path = path.join(agent_path, "session-files", storage_id);
  const attachment_path = path.join(record_path, "attachments", "manual.txt");
  fs.mkdirSync(path.dirname(attachment_path), { recursive: true }); fs.writeFileSync(attachment_path, "attachment contents");
  database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(1,'file','user',1,'file',?,1,1)")
    .run(JSON.stringify({ media_type: "text/plain", url: attachment_path, media_version: "original-version" }));
  database.prepare("UPDATE sessions SET message_count=1 WHERE session_key=1").run();
  database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,origin_storage_id,origin_session_id,origin_message_id,created_at,updated_at) VALUES(2,'forked-user',1,'user',NULL,?,'writer','user',1,1)").run(storage_id);
  database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(2,'fork-text','forked-user',1,'text',?,1,1)")
    .run(JSON.stringify({ text: "writer old-work remain human text" }));
  database.prepare("UPDATE sessions SET message_count=1 WHERE session_key=2").run();
  database.prepare("INSERT INTO operation_receipts(operation_id,request_hash,storage_id,result,committed_at) VALUES(?,?,?,?,1)")
    .run(random_uuid(), "a".repeat(64), storage_id, JSON.stringify({ storage_id }));
  database.exec("PRAGMA user_version=8;"); database.close();
  fs.writeFileSync(path.join(record_path, ".owned-attachments.json"), JSON.stringify({ format_version: 1, agent_id: "writer", storage_id, files: ["manual.txt"] }), { mode: 0o600 });
  fs.writeFileSync(path.join(root, "session-storage.json"), JSON.stringify({ format_version: 8, state: "ready" }));
  const notification = path.join(root, "powers/notification/notifications.json"); fs.mkdirSync(path.dirname(notification), { recursive: true });
  fs.writeFileSync(notification, JSON.stringify([{ target: { kind: "agent_session", agent_id: "writer", session_id: "writer", category: "chat", origin_type: "agent" }, read: true, body: "writer" }]));
  const task = path.join(root, "powers/task/tasks/daily/task.toml"); fs.mkdirSync(path.dirname(task), { recursive: true });
  fs.writeFileSync(task, 'title="daily"\nprompt="writer old-work"\n[delivery_session]\nagent_id="writer"\nsession_id="writer"\ncategory="chat"\n');
  const completion_path = path.join(agent_path, "completions"); fs.mkdirSync(completion_path);
  const event = { completion_id: "completion:writer:turn", session_id: "writer", turn_id: "turn", status: "completed", result: { text: "writer", success: true }, messages: [] };
  fs.writeFileSync(path.join(completion_path, `${hash_text(event.completion_id)}.json`), JSON.stringify({ event, origin: { category: "chat", type: "agent" }, state: "delivered", deliveries: {} }));
  return { root, batch, database_path, attachment_path, storage_id, work_storage_id, notification, task, directory };
}

test("参数默认只读且 apply/restore 必须声明已停写", () => {
  assert.equal(parse_arguments([]).mode, "preflight");
  assert.throws(() => parse_arguments(["--apply", "--batch", "/tmp/batch"]), /writers_stopped/);
  assert.throws(() => parse_arguments(["--apply", "--preflight"]), /conflicting_modes/);
  assert.throws(() => parse_arguments(["--agent", "writer"]), /unknown_argument/);
});

test("重复旧 ID 的完成日志只在 canonical Turn 和全部消息唯一匹配时转换", context => {
  const fixture_ = fixture(context);
  const source = new DatabaseSync(fixture_.database_path);
  try {
    source.exec("UPDATE sessions SET archived=1,archived_at=2 WHERE session_key=1; UPDATE messages SET turn_id='old-turn' WHERE session_key=1");
    source.prepare("INSERT INTO sessions(session_key,storage_id,session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(3,?,'writer','chat',?,'UTC',1,3,3)")
      .run(random_uuid(), JSON.stringify({ category: "chat", type: "agent" }));
    source.exec("INSERT INTO messages(session_key,message_id,sequence,role,turn_id,created_at,updated_at) VALUES(3,'new-user',1,'user','new-turn',3,3)");
    const identities = identity_rows(source, "writer");
    const agents = [{ agent_id: "writer", identities }];
    const migration_context = { root_path: fixture_.root, agents, resolve: create_resolver(agents) };
    const completion = (turn_id, message_id) => ({ event: {
      session_id: "writer", turn_id, completion_id: `completion:writer:${turn_id}`,
      messages: [{ session_id: "writer", turn_id, message_id, parts: [] }],
    }, origin: { category: "chat", type: "agent" } });
    for (const [key, turn_id, message_id] of [[1, "old-turn", "user"], [3, "new-turn", "new-user"]]) {
      const converted = rewrite_completion(completion(turn_id, message_id), "writer", migration_context);
      const expected = identities.find(item => item.session_key === key).session_id;
      assert.equal(converted.event.session_id, expected);
      assert.equal(converted.event.messages[0].session_id, expected);
      assert.equal(converted.event.completion_id, `completion:${expected}:${turn_id}`);
    }
    // 早期完成日志缺少 category，仍必须以同一组 canonical 消息确认归属。
    const early = completion("new-turn", "new-user"); delete early.origin.category;
    assert.equal(rewrite_completion(early, "writer", migration_context).event.session_id, identities.find(item => item.session_key === 3).session_id);
    assert.throws(() => rewrite_completion(completion("missing-turn", "missing"), "writer", migration_context), /ambiguous_session_reference/);
    assert.throws(() => rewrite_completion(completion("new-turn", "user"), "writer", migration_context), /ambiguous_session_reference/);
    source.exec("INSERT INTO messages(session_key,message_id,sequence,role,turn_id,created_at,updated_at) VALUES(3,'user',2,'user','old-turn',3,3)");
    assert.throws(() => rewrite_completion(completion("old-turn", "user"), "writer", migration_context), /ambiguous_session_reference/);
  } finally { source.close(); }
});

test("重复旧 ID 的工具引用只接受唯一 canonical Part 摘要，拒绝不匹配和多重匹配", context => {
  const fixture_ = fixture(context);
  const source = new DatabaseSync(fixture_.database_path);
  try {
    source.exec("UPDATE sessions SET archived=1,archived_at=2 WHERE session_key=1");
    source.prepare("INSERT INTO sessions(session_key,storage_id,session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(3,?,'writer','chat',?,'UTC',1,3,3)")
      .run(random_uuid(), JSON.stringify({ category: "chat", type: "agent" }));
    const content = { tool_call_id: "call", tool_name: "read", state: "completed", output: "canonical result" };
    source.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(3,'tool',1,'agent','done',3,3)");
    source.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(3,'tool','tool',1,'tool',?,3,3)").run(JSON.stringify(content));
    const agents = [{ agent_id: "writer", identities: identity_rows(source, "writer") }];
    const migration_context = { root_path: fixture_.root, agents, resolve: create_resolver(agents) };
    const reference = digest => `res_1_${Buffer.from(JSON.stringify({ session_id: "writer", category: "chat", message_id: "tool", message_sequence: 1, part_id: "tool", digest })).toString("base64url")}`;
    const rewriter = create_result_rewriter(migration_context, runtime);
    try {
      const result = rewriter.rewrite(reference(runtime.result_digest(runtime.tool_result_value(content))), "writer", migration_context.resolve);
      assert.equal(JSON.parse(Buffer.from(result.slice(6), "base64url").toString()).session_id, agents[0].identities.find(item => item.session_key === 3).session_id);
      assert.throws(() => rewriter.rewrite(reference("a".repeat(43)), "writer", migration_context.resolve), /ambiguous_session_reference/);
    } finally { rewriter.close(); }
    source.prepare("INSERT INTO sessions(session_key,storage_id,session_id,category,origin,timezone,archived,archived_at,message_count,created_at,updated_at) VALUES(4,?,'writer','chat',?,'UTC',1,3,1,3,3)")
      .run(random_uuid(), JSON.stringify({ category: "chat", type: "agent" }));
    source.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(4,'tool',1,'agent','done',3,3)");
    source.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(4,'tool','tool',1,'tool',?,3,3)").run(JSON.stringify(content));
    agents[0].identities = identity_rows(source, "writer"); migration_context.resolve = create_resolver(agents);
    const duplicate = create_result_rewriter(migration_context, runtime);
    try { assert.throws(() => duplicate.rewrite(reference(runtime.result_digest(runtime.tool_result_value(content))), "writer", migration_context.resolve), /ambiguous_session_reference/); }
    finally { duplicate.close(); }
  } finally { source.close(); }
});

test("全根预检不改原库；保留源记录 UUID，消息/fork/附件/业务引用一致，完整恢复", async context => {
  const fixture_ = fixture(context);
  const source_fingerprint = fingerprint_file(fixture_.database_path);
  const original_inode = fs.statSync(fixture_.attachment_path).ino;
  const planned = await preflight(fixture_.root, runtime);
  assert.equal(planned.status, "planned", JSON.stringify(planned.blockers));
  assert.equal(fingerprint_file(fixture_.database_path), source_fingerprint);
  const applied = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(applied.status, "ready");
  const identities = applied.agents[0].identities;
  assert.equal(applied.identity_policy, identity_policy);
  assert(identities.every(row => row.session_id === row.source_storage_id && row.session_id !== row.source_session_id));
  assert(applied.artifacts.filter(item => item.kind === "directory").every(item => item.relative_path === item.target_relative));
  const main_id = identities.find(row => row.session_key === 1).session_id;
  const database = open_source(fixture_.database_path);
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 9);
    assert(!database.prepare("PRAGMA table_info(sessions)").all().some(column => column.name === "storage_id"));
    assert.equal(database.prepare("SELECT main_session_id FROM agent_session_state").get().main_session_id, main_id);
    assert.equal(database.prepare("SELECT origin_session_id FROM messages WHERE session_key=2").get().origin_session_id, main_id);
    assert.equal(JSON.parse(database.prepare("SELECT origin FROM sessions WHERE session_key=2").get().origin).parent_session_id, main_id);
    assert.equal(database.prepare("SELECT count(*) AS total FROM legacy_operation_ids").get().total, 1);
    const file = JSON.parse(database.prepare("SELECT content FROM message_parts WHERE part_id='file'").get().content);
    assert.equal(fs.statSync(file.url).ino, original_inode);
    assert.equal(file.media_version, "original-version");
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(file.url)), ".owned-attachments.json"), "utf8"));
    assert.equal(manifest.session_id, main_id); assert.equal(manifest.format_version, 2); assert(!("storage_id" in manifest));
  } finally { database.close(); }
  assert.equal(JSON.parse(fs.readFileSync(fixture_.notification, "utf8"))[0].target.session_id, main_id);
  assert.match(fs.readFileSync(fixture_.task, "utf8"), /writer old-work/u);
  assert.equal(verify_batch(fixture_.root, fixture_.batch, runtime).status, "verified");
  assert.equal((await migrate(fixture_.root, fixture_.batch, runtime)).status, "verified");
  assert.equal(restore_batch(fixture_.root, fixture_.batch, runtime).status, "restored");
  assert.equal(fingerprint_file(fixture_.database_path), source_fingerprint);
  assert.equal(fs.statSync(fixture_.attachment_path).ino, original_inode);
});

test("业务写入后全批拒绝恢复，原始备份保留", async context => {
  const fixture_ = fixture(context);
  await migrate(fixture_.root, fixture_.batch, runtime);
  const database = new DatabaseSync(fixture_.database_path);
  database.exec("UPDATE sessions SET title='new user title' WHERE session_key=1"); database.close();
  assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /published_target_changed_or_business_write/);
  assert.equal(read_manifest(fixture_.root, fixture_.batch).status, "ready");
});

test("未完成执行或旧归档计划阻塞全批，不写批次和根标记", async context => {
  const fixture_ = fixture(context);
  const database = new DatabaseSync(fixture_.database_path);
  database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,'unfinished',2,'agent','streaming',1,1)").run();
  database.prepare("UPDATE sessions SET message_count=2 WHERE session_key=1").run(); database.close();
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(result.status, "blocked"); assert(result.blockers.some(item => item.reason === "unfinished_session_turn"));
  assert(!fs.existsSync(fixture_.batch));
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture_.root, "session-storage.json"), "utf8")).format_version, 8);
});

test("共享根被占用时禁止迁移；映射拒绝有歧义的旧逻辑引用", async context => {
  const fixture_ = fixture(context);
  const lease = runtime.RootLease.acquire_write(fixture_.root);
  try { await assert.rejects(migrate(fixture_.root, fixture_.batch, runtime)); } finally { lease.release(); }
  assert(!fs.existsSync(fixture_.batch));
  const rows = [false, true].map(archived => {
    const storage_id = random_uuid();
    return { agent_id: "writer", session_key: archived ? 2 : 1, source_storage_id: storage_id,
      source_session_id: "duplicate", category: "chat", archived, session_id: storage_id };
  });
  const resolve = create_resolver([{ agent_id: "writer", identities: rows }]);
  assert.throws(() => resolve("writer", "duplicate", "chat"), /ambiguous_session_reference/);
  assert.equal(resolve("writer", "duplicate", "chat", rows[1].source_storage_id), rows[1].session_id);
  assert.equal(resolve("writer", "duplicate", "chat", undefined, true), rows[0].session_id);
});

test("发布数据库后 ACK 丢失可以用同批次继续，不重新分配 Session UUID", async context => {
  const fixture_ = fixture(context);
  const original_rename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    original_rename(source, target);
    if (!interrupted && target === fixture_.database_path) { interrupted = true; throw new Error("simulated_publish_crash"); }
  };
  try { await assert.rejects(migrate(fixture_.root, fixture_.batch, runtime), /simulated_publish_crash/); }
  finally { fs.renameSync = original_rename; }
  const before = read_manifest(fixture_.root, fixture_.batch);
  assert.equal(before.status, "publishing");
  await assert.rejects(runtime.assert_session_storage_ready(fixture_.root), /session_migration_required/);
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.deepEqual(result.agents[0].identities, before.agents[0].identities);
  assert.equal(verify_batch(fixture_.root, fixture_.batch, runtime).status, "verified");
  await runtime.assert_session_storage_ready(fixture_.root);
});

test("migrating 标记发布后清单 ACK 丢失可恢复，旧 v8 根不会被 readiness 当作可运行", async context => {
  const fixture_ = fixture(context);
  await assert.rejects(runtime.assert_session_storage_ready(fixture_.root), /session_migration_required/);
  const original_rename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    original_rename(source, target);
    if (!interrupted && target === path.join(fixture_.root, "session-storage.json")) { interrupted = true; throw new Error("simulated_marker_crash"); }
  };
  try { await assert.rejects(migrate(fixture_.root, fixture_.batch, runtime), /simulated_marker_crash/); }
  finally { fs.renameSync = original_rename; }
  assert.equal(read_manifest(fixture_.root, fixture_.batch).status, "prepared");
  assert.equal((await migrate(fixture_.root, fixture_.batch, runtime)).status, "ready");
});

test("渠道副本保留外键表与收发载荷，仅重写已声明会话路由", async context => {
  const fixture_ = fixture(context);
  const channel_path = path.join(fixture_.root, "powers/messenger"); fs.mkdirSync(channel_path, { recursive: true });
  const database_path = path.join(channel_path, "messenger.db"); const database = new DatabaseSync(database_path);
  // 表名的字典序故意与 FK 依赖顺序不同，复制不能依赖建表时即可插入数据。
  database.exec(`CREATE TABLE messenger_conversations(conversation_id TEXT PRIMARY KEY,agent_id TEXT,session_id TEXT);
    CREATE TABLE messenger_activity(activity_id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES messenger_conversations(conversation_id),detail_json TEXT);
    CREATE TABLE messenger_completion_routes(agent_id TEXT,session_id TEXT,turn_id TEXT,PRIMARY KEY(agent_id,session_id,turn_id));
    INSERT INTO messenger_conversations VALUES('conversation','writer','writer');
    INSERT INTO messenger_activity VALUES('activity','conversation','{"body":"writer"}');
    INSERT INTO messenger_completion_routes VALUES('writer','writer','turn');`);
  database.close();
  const original = fingerprint_file(database_path);
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const source = open_source(database_path);
  try {
    const main = result.agents[0].identities.find(row => row.session_key === 1).session_id;
    assert.equal(source.prepare("SELECT session_id FROM messenger_conversations").get().session_id, main);
    assert.equal(source.prepare("SELECT session_id FROM messenger_completion_routes").get().session_id, main);
    assert.equal(source.prepare("SELECT detail_json FROM messenger_activity").get().detail_json, '{"body":"writer"}');
  } finally { source.close(); }
  restore_batch(fixture_.root, fixture_.batch, runtime);
  assert.equal(fingerprint_file(database_path), original);
});

test("工具结果引用、lookup 页和披露游标改为 res_2 并绑定转换后的 canonical 摘要", async context => {
  const fixture_ = fixture(context);
  const database = new DatabaseSync(fixture_.database_path);
  const location = (message_id, sequence, part_id, output) => `res_1_${Buffer.from(JSON.stringify({ storage_id: fixture_.storage_id,
    session_id: "writer", category: "chat", message_id, message_sequence: sequence, part_id,
    digest: runtime.result_digest(output) })).toString("base64url")}`;
  const original_output = "abcdef";
  const original_ref = location("tool-message", 2, "tool-part", original_output);
  const payload = "1:2";
  const cursor = Buffer.from(`${payload}:${create_hash("sha256").update(original_ref).update("\0").update(payload).digest("base64url")}`).toString("base64url");
  const lookup_output = { view: "result_page", result_ref: original_ref, format: "text", text: "ab", next_cursor: cursor, eof: false };
  const lookup_ref = location("lookup-message", 3, "lookup-part", lookup_output);
  const insert_message = database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,?,?,'agent','done',1,1)");
  const insert_part = database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(1,?,?,1,'tool',?,1,1)");
  insert_message.run("tool-message", 2);
  insert_part.run("tool-part", "tool-message", JSON.stringify({ tool_call_id: "call", tool_name: "read", state: "completed", output: original_output, result_ref: original_ref }));
  insert_message.run("lookup-message", 3);
  insert_part.run("lookup-part", "lookup-message", JSON.stringify({ tool_call_id: "lookup-call", tool_name: "lookup", state: "completed", output: lookup_output,
    model_output: lookup_output, disclosure_version: 1, result_ref: lookup_ref }));
  database.exec("UPDATE sessions SET message_count=3 WHERE session_key=1"); database.close();
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const target = open_source(fixture_.database_path);
  try {
    const content = JSON.parse(target.prepare("SELECT content FROM message_parts WHERE part_id='lookup-part'").get().content);
    const snapshot = runtime.parse_result_ref(content.result_ref);
    assert.equal(snapshot.digest, runtime.result_digest(content.output));
    assert(content.output.result_ref.startsWith("res_2_"));
    assert.equal(content.model_output.result_ref, content.output.result_ref);
    assert.notEqual(content.output.next_cursor, cursor);
    const nested = runtime.parse_result_ref(content.output.result_ref);
    assert.equal(nested.digest, runtime.result_digest(original_output));
    assert(!("storage_id" in nested));
  } finally { target.close(); }
});

test("平台设置、委派关系和已关闭父 Turn 随新 Session UUID 转换，业务文本保持原值", async context => {
  const fixture_ = fixture(context);
  const platform = new DatabaseSync(path.join(fixture_.root, "downcity.db"));
  platform.exec("CREATE TABLE platform_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at INTEGER)");
  const settings = platform.prepare("INSERT INTO platform_settings VALUES(?,?,1)");
  settings.run("desktop.settings", JSON.stringify({ session_pins: [`agent-record:${JSON.stringify(["writer", fixture_.storage_id, false])}`], default_agent_id: "writer" }));
  settings.run("desktop.session-models", JSON.stringify({ ["writer\0\0writer\0chat\0agent"]: "model", "old-unused-key": "old-model" }));
  platform.close();
  const delegation_path = path.join(fixture_.root, "agents/writer/delegations"); fs.mkdirSync(delegation_path);
  const delegation_id = "a".repeat(64);
  const caller = { agent_id: "writer", session_id: "writer", turn_id: "turn", tool_call_id: "call", origin: { category: "chat", type: "agent" } };
  fs.writeFileSync(path.join(delegation_path, `${delegation_id}.json`), JSON.stringify({ delegation_id, caller, work_session_id: "old-work", delivery_state: "delivered", execution_state: "completed", query: "writer old-work" }));
  const source = new DatabaseSync(fixture_.database_path);
  source.exec("UPDATE messages SET turn_id='turn' WHERE session_key=1"); source.close();
  const closed_path = path.join(delegation_path, "closed"); fs.mkdirSync(closed_path);
  const closed_key = session_id => hash_text(JSON.stringify(["writer", "chat", session_id, "turn"]));
  fs.writeFileSync(path.join(closed_path, closed_key("writer")), "closed");
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const main = result.agents[0].identities.find(row => row.session_key === 1).session_id;
  const work = result.agents[0].identities.find(row => row.session_key === 2).session_id;
  const delegation = JSON.parse(fs.readFileSync(path.join(delegation_path, `${delegation_id}.json`), "utf8"));
  assert.equal(delegation.caller.session_id, main); assert.equal(delegation.work_session_id, work);
  assert.equal(delegation.query, "writer old-work"); assert.equal(delegation.delegation_id, delegation_id);
  assert(fs.existsSync(path.join(closed_path, closed_key(main))));
  assert(!fs.existsSync(path.join(closed_path, closed_key("writer"))));
  const database = open_source(path.join(fixture_.root, "downcity.db"));
  try {
    const prefs = JSON.parse(database.prepare("SELECT value_json FROM platform_settings WHERE key='desktop.settings'").get().value_json);
    assert.equal(prefs.session_pins[0], `agent-record:${JSON.stringify(["writer", main, false])}`);
    const models = JSON.parse(database.prepare("SELECT value_json FROM platform_settings WHERE key='desktop.session-models'").get().value_json);
    assert.equal(models[`writer\0\0${main}\0chat\0agent`], "model"); assert.equal(models["old-unused-key"], "old-model");
  } finally { database.close(); }
});

test("恢复标记和恢复完成 ACK 丢失均可继续，原始/暂存副本保留", async context => {
  const fixture_ = fixture(context);
  const original = fingerprint_file(fixture_.database_path);
  await migrate(fixture_.root, fixture_.batch, runtime);
  const marker_path = path.join(fixture_.root, "session-storage.json");
  const rename = fs.renameSync;
  let stage = "restoring-marker";
  fs.renameSync = (source, target) => {
    rename(source, target);
    if (target !== marker_path) return;
    const marker = JSON.parse(fs.readFileSync(marker_path, "utf8"));
    if (stage === "restoring-marker" && marker.state === "restoring") { stage = "restored-marker"; throw new Error("simulated_restore_marker_crash"); }
    if (stage === "restored-marker" && marker.format_version === 8) { stage = "complete"; throw new Error("simulated_restore_final_ack_crash"); }
  };
  try {
    assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /simulated_restore_marker_crash/);
    assert.equal(read_manifest(fixture_.root, fixture_.batch).status, "ready");
    assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /simulated_restore_final_ack_crash/);
    assert.equal(read_manifest(fixture_.root, fixture_.batch).status, "restoring");
    assert.equal(restore_batch(fixture_.root, fixture_.batch, runtime).status, "restored");
  } finally { fs.renameSync = rename; }
  assert.equal(fingerprint_file(fixture_.database_path), original);
  assert(fs.existsSync(path.join(fixture_.batch, "original"))); assert(fs.existsSync(path.join(fixture_.batch, "staged")));
});

test("摘要从强制备份保留，目标清空派生检查点；重复根 UUID 被启动门禁拒绝", async context => {
  const fixture_ = fixture(context);
  const database = new DatabaseSync(fixture_.database_path);
  database.prepare(`INSERT INTO composer_checkpoints(session_key,namespace,checkpoint_id,through_message_id,
    through_message_sequence,through_part_sequence,summary,schema_version,created_at) VALUES(1,'composer','checkpoint','user',1,1,'writer old identity',1,1)`).run();
  database.close();
  const result = await migrate(fixture_.root, fixture_.batch, runtime);
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const target = open_source(fixture_.database_path);
  try { assert.equal(target.prepare("SELECT count(*) AS count FROM composer_checkpoints").get().count, 0); }
  finally { target.close(); }
  const other_path = path.join(fixture_.root, "agents/other"); fs.mkdirSync(other_path);
  fs.copyFileSync(fixture_.database_path, path.join(other_path, "sessions.db"));
  const other = new DatabaseSync(path.join(other_path, "sessions.db"));
  other.exec("UPDATE storage_metadata SET agent_id='other'"); other.close();
  await assert.rejects(runtime.assert_session_storage_ready(fixture_.root), /session_storage_identity_conflict/);
});

test("迁移完成后新增引用资源阻止整批恢复，不把新资源留在旧身份根中", async context => {
  const fixture_ = fixture(context);
  await migrate(fixture_.root, fixture_.batch, runtime);
  fs.writeFileSync(path.join(fixture_.root, "agents/writer/completions/new-business-completion.json"), "{}");
  assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /reference_scope_changed/);
  assert.equal(read_manifest(fixture_.root, fixture_.batch).status, "ready");
});

test("结果引用摘要不符时阻塞，不发布无效的 res_2 引用", async context => {
  const fixture_ = fixture(context);
  const database = new DatabaseSync(fixture_.database_path);
  database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,'tool',2,'agent','done',1,1)").run();
  const result_ref = `res_1_${Buffer.from(JSON.stringify({ storage_id: fixture_.storage_id, session_id: "writer", category: "chat", message_id: "tool", message_sequence: 2, part_id: "tool", digest: "a".repeat(43) })).toString("base64url")}`;
  database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(1,'tool','tool',1,'tool',?,1,1)")
    .run(JSON.stringify({ tool_call_id: "call", tool_name: "read", state: "completed", output: "real output", result_ref }));
  database.exec("UPDATE sessions SET message_count=2 WHERE session_key=1"); database.close();
  const result = await preflight(fixture_.root, runtime);
  assert.equal(result.status, "blocked"); assert(result.blockers.some(item => item.reason === "result_reference_digest_mismatch"));
  assert(!fs.existsSync(fixture_.batch));
});

test("显式恢复将精确 streaming 消息收口为中断，保留正文、终态工具和原始快照，可完整恢复", async context => {
  const fixture_ = fixture(context);
  const source = new DatabaseSync(fixture_.database_path);
  source.exec("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(1,'interrupted',2,'agent','streaming',4,5)");
  const part = source.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(1,?,'interrupted',?,?,?,4,5)");
  part.run("text", 1, "text", JSON.stringify({ text: "keep exact text", state: "done" }));
  part.run("done", 2, "tool", JSON.stringify({ tool_call_id: "done", tool_name: "shell", state: "completed", output: "keep output" }));
  const result_ref = `res_1_${Buffer.from(JSON.stringify({ storage_id: fixture_.storage_id, session_id: "writer", category: "chat",
    message_id: "interrupted", message_sequence: 2, part_id: "ready", digest: runtime.result_digest(null) })).toString("base64url")}`;
  part.run("ready", 3, "tool", JSON.stringify({ tool_call_id: "ready", tool_name: "shell", state: "ready", input: { command: "never execute" }, result_ref,
    interactions: [{ status: "pending", interaction_id: "approval", interaction_type: "approval", request: {
      interaction_id: "approval", turn_id: "turn", type: "approval", source: { type: "shell", tool_call_id: "ready" }, payload: {}, created_at: 4,
    } }] }));
  part.run("action", 4, "action", JSON.stringify({ action_id: "action", action_type: "custom", state: "running", title: "Original action", description: "original action description" }));
  source.exec("UPDATE sessions SET message_count=2 WHERE session_key=1"); source.close();
  const fingerprint = fingerprint_file(fixture_.database_path);
  assert.equal((await preflight(fixture_.root, runtime)).status, "blocked");
  const planned = await preflight(fixture_.root, runtime, { recover_reviewed: true });
  assert.equal(planned.status, "planned", JSON.stringify(planned.blockers));
  assert.equal(fingerprint_file(fixture_.database_path), fingerprint);
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready");
  const target = open_source(fixture_.database_path);
  try {
    assert.equal(target.prepare("SELECT state FROM messages WHERE message_id='interrupted'").get().state, "done");
    const parts = target.prepare("SELECT type,content FROM message_parts WHERE message_id='interrupted' ORDER BY sequence").all();
    assert.equal(JSON.parse(parts[0].content).text, "keep exact text");
    assert.equal(JSON.parse(parts[1].content).output, "keep output");
    const failed = JSON.parse(parts[2].content); assert.equal(failed.state, "failed");
    assert.equal(failed.input.command, "never execute"); assert.equal(failed.interactions[0].cancel_reason, "runtime_interrupted");
    assert.equal(JSON.parse(Buffer.from(failed.result_ref.slice(6), "base64url").toString()).digest,
      runtime.result_digest(runtime.tool_result_value(failed)));
    assert.equal(JSON.parse(parts[3].content).state, "failed"); assert.equal(JSON.parse(parts[3].content).description, "original action description");
    assert.equal(parts[4].type, "error"); assert.equal(JSON.parse(parts[4].content).code, "turn_stopped");
  } finally { target.close(); }
  restore_batch(fixture_.root, fixture_.batch, runtime);
  assert.equal(fingerprint_file(fixture_.database_path), fingerprint);
});

test("失效已完成账本移入审计目录，逐字节保留并可重入发布及完整恢复", async context => {
  const fixture_ = fixture(context); const agent_path = path.join(fixture_.root, "agents/writer");
  const event = { session_id: "missing", turn_id: "turn", completion_id: "completion:missing:turn", messages: [] };
  const ledger = path.join(agent_path, "completions", `${hash_text(event.completion_id)}.json`);
  const raw = JSON.stringify({ event, origin: { category: "chat", type: "agent" }, state: "delivered", deliveries: {} });
  fs.writeFileSync(ledger, raw);
  const closed = path.join(agent_path, "delegations/closed", "a".repeat(64)); fs.mkdirSync(path.dirname(closed), { recursive: true }); fs.writeFileSync(closed, "closed");
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const audit = path.join(fixture_.root, ".session-v9-audit", result.migration_id);
  assert.equal(fs.readFileSync(path.join(audit, path.relative(fixture_.root, ledger)), "utf8"), raw);
  assert.equal(fs.readFileSync(path.join(audit, path.relative(fixture_.root, closed)), "utf8"), "closed");
  assert(!fs.existsSync(ledger)); assert(!fs.existsSync(closed));
  assert.equal((await migrate(fixture_.root, fixture_.batch, runtime)).status, "verified");
  restore_batch(fixture_.root, fixture_.batch, runtime);
  assert.equal(fs.readFileSync(ledger, "utf8"), raw); assert.equal(fs.readFileSync(closed, "utf8"), "closed");
  assert(!fs.existsSync(path.join(audit, path.relative(fixture_.root, ledger))));
});

test("Group 大小写校正保留目录 ID，冲突或不相关身份差异仍然拒绝", async context => {
  const fixture_ = fixture(context);
  const directory = path.join(fixture_.root, "groups/team/sessions/Group-ABC"); fs.mkdirSync(directory, { recursive: true });
  const file_path = path.join(directory, "meta.json");
  fs.writeFileSync(file_path, JSON.stringify({ v: 2, group_id: "team", session_id: "group-abc", created_at: 1, updated_at: 1, message_count: 0 }));
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  assert.equal(JSON.parse(fs.readFileSync(file_path, "utf8")).session_id, "Group-ABC");
  restore_batch(fixture_.root, fixture_.batch, runtime);
  assert.equal(JSON.parse(fs.readFileSync(file_path, "utf8")).session_id, "group-abc");
  fs.writeFileSync(file_path, JSON.stringify({ v: 2, group_id: "team", session_id: "another" }));
  await assert.rejects(preflight(fixture_.root, runtime, { recover_reviewed: true }), /group_metadata_invalid/);
});

test("失效 Task 和渠道投递暂停，正文与队列载荷保持原值，未完成账本不得隔离", async context => {
  const fixture_ = fixture(context);
  fs.writeFileSync(fixture_.task, 'title="daily"\nprompt="keep writer"\nschedule="enabled"\n[delivery_session]\nagent_id="writer"\nsession_id="missing"\ncategory="chat"\n');
  const channel_path = path.join(fixture_.root, "powers/chat/chat.db"); fs.mkdirSync(path.dirname(channel_path), { recursive: true });
  const channel = new DatabaseSync(channel_path);
  channel.exec(`CREATE TABLE chat_meta(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
    CREATE TABLE chat_conversations(conversation_id TEXT PRIMARY KEY,agent_id TEXT,session_id TEXT,status TEXT,updated_at INTEGER);
    CREATE TABLE chat_inbox(conversation_id TEXT,payload_json TEXT,status TEXT,lease_expires_at INTEGER,error TEXT);
    CREATE TABLE chat_outbox(conversation_id TEXT,payload_json TEXT,status TEXT,lease_expires_at INTEGER,error TEXT);
    INSERT INTO chat_conversations VALUES('conversation','writer','missing','active',1);
    INSERT INTO chat_meta VALUES('channel_session:conversation','missing',1);
    INSERT INTO chat_inbox VALUES('conversation','original inbound','pending',NULL,NULL);
    INSERT INTO chat_outbox VALUES('conversation','original outbound','pending',NULL,NULL);`); channel.close();
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const task = fs.readFileSync(fixture_.task, "utf8"); assert.match(task, /schedule = "paused"/); assert.match(task, /keep writer/); assert.match(task, /unavailable_delivery/);
  const target = open_source(channel_path);
  try {
    assert.deepEqual({ ...target.prepare("SELECT session_id,status FROM chat_conversations").get() }, { session_id: "", status: "paused" });
    assert.equal(target.prepare("SELECT payload_json FROM chat_inbox").get().payload_json, "original inbound");
    assert.equal(target.prepare("SELECT payload_json FROM chat_outbox").get().payload_json, "original outbound");
    assert.equal(target.prepare("SELECT status FROM chat_outbox").get().status, "failed");
    assert.equal(target.prepare("SELECT count(*) AS count FROM chat_meta WHERE key LIKE 'channel_session:%'").get().count, 0);
  } finally { target.close(); }
  restore_batch(fixture_.root, fixture_.batch, runtime);
  assert.match(fs.readFileSync(fixture_.task, "utf8"), /schedule="enabled"/);
  const messenger_path = path.join(fixture_.root, "powers/messenger/messenger.db"); fs.mkdirSync(path.dirname(messenger_path), { recursive: true });
  const messenger = new DatabaseSync(messenger_path);
  messenger.exec("CREATE TABLE messenger_conversations(conversation_id TEXT PRIMARY KEY,agent_id TEXT,session_id TEXT,status TEXT,updated_at INTEGER); INSERT INTO messenger_conversations VALUES('conversation','writer','missing','active',1)");
  messenger.close();
  const event = { session_id: "missing", turn_id: "turn", completion_id: "completion:missing:turn", messages: [] };
  const ledger = path.join(fixture_.root, "agents/writer/completions", `${hash_text(event.completion_id)}.json`);
  fs.writeFileSync(ledger, JSON.stringify({ event, origin: { category: "chat" }, state: "pending" }));
  const blocked = await preflight(fixture_.root, runtime, { recover_reviewed: true });
  assert.equal(blocked.status, "blocked"); assert(blocked.blockers.some(item => item.reason === "pending_ledger_requires_review"));
  assert(blocked.blockers.some(item => item.reason === "messenger_route_requires_rebind"));
});

test("活动 Agent fork 不争夺主指针，Group 只停用已删除 Agent 的历史成员引用", async context => {
  const fixture_ = fixture(context);
  const source = new DatabaseSync(fixture_.database_path);
  source.prepare("INSERT INTO sessions(session_key,storage_id,session_id,category,origin,timezone,message_count,created_at,updated_at) VALUES(3,?,'fork-main','chat',?,'UTC',0,2,2)")
    .run(random_uuid(), JSON.stringify({ category: "chat", type: "agent" }));
  source.close();
  const file_path = path.join(fixture_.root, "groups/team/sessions/group/meta.json"); fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const raw = JSON.stringify({ v: 2, group_id: "team", session_id: "group", member_session_ids: { writer: "writer", removed: "old-member" } });
  fs.writeFileSync(file_path, raw);
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready", JSON.stringify(result.blockers));
  const main = result.agents[0].identities.find(item => item.session_key === 1).session_id;
  const target = open_source(fixture_.database_path);
  try { assert.equal(target.prepare("SELECT main_session_id FROM agent_session_state").get().main_session_id, main); }
  finally { target.close(); }
  const metadata = JSON.parse(fs.readFileSync(file_path, "utf8"));
  assert.deepEqual(metadata.member_session_ids, { writer: main });
  assert.deepEqual(metadata.unavailable_member_sessions, { removed: { session_id: "old-member", reason: "agent_removed" } });
  restore_batch(fixture_.root, fixture_.batch, runtime); assert.equal(fs.readFileSync(file_path, "utf8"), raw);
  fs.writeFileSync(file_path, JSON.stringify({ ...JSON.parse(raw), member_session_ids: { writer: "missing" } }));
  const blocked = await preflight(fixture_.root, runtime, { recover_reviewed: true });
  assert.equal(blocked.status, "blocked"); assert(blocked.blockers.some(item => item.reason === "session_reference_not_found"));
});

test("同路径附件验证后 ACK 丢失仍能重入，附件引用文件进度先于目录持久化", async context => {
  const fixture_ = fixture(context); const original_rename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    original_rename(source, target);
    if (!interrupted && target === path.join(fixture_.batch, "manifest.json")) {
      const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
      if (manifest.status === "publishing" && manifest.artifacts.filter(item => item.kind === "directory").every(item => item.published)) {
        interrupted = true; throw new Error("simulated_attachment_ack_crash");
      }
    }
  };
  try { await assert.rejects(migrate(fixture_.root, fixture_.batch, runtime), /simulated_attachment_ack_crash/); }
  finally { fs.renameSync = original_rename; }
  const before = read_manifest(fixture_.root, fixture_.batch);
  assert(before.artifacts.filter(item => item.kind !== "directory").every(item => item.published));
  assert.equal((await migrate(fixture_.root, fixture_.batch, runtime)).status, "ready");
  assert.deepEqual(read_manifest(fixture_.root, fixture_.batch).agents[0].identities, before.agents[0].identities);
  restore_batch(fixture_.root, fixture_.batch, runtime); assert(fs.existsSync(fixture_.attachment_path));
});

test("审计发布后删除源文件中断可重入；审计被改写或新增资源后禁止恢复", async context => {
  const fixture_ = fixture(context);
  const closed = path.join(fixture_.root, "agents/writer/delegations/closed", "a".repeat(64));
  fs.mkdirSync(path.dirname(closed), { recursive: true }); fs.writeFileSync(closed, "closed");
  const original_unlink = fs.unlinkSync; let interrupted = false;
  fs.unlinkSync = file_path => {
    original_unlink(file_path);
    if (!interrupted && file_path === closed) { interrupted = true; throw new Error("simulated_audit_unlink_crash"); }
  };
  try { await assert.rejects(migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true }), /simulated_audit_unlink_crash/); }
  finally { fs.unlinkSync = original_unlink; }
  const result = await migrate(fixture_.root, fixture_.batch, runtime, { recover_reviewed: true });
  assert.equal(result.status, "ready");
  const audit = path.join(fixture_.root, ".session-v9-audit", result.migration_id, path.relative(fixture_.root, closed));
  assert.equal(fs.readFileSync(audit, "utf8"), "closed");
  fs.writeFileSync(audit, "changed");
  assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /published_target_changed_or_business_write/);
  fs.writeFileSync(audit, "closed"); fs.writeFileSync(`${audit}.new`, "new audit record");
  assert.throws(() => restore_batch(fixture_.root, fixture_.batch, runtime), /reference_scope_changed/);
  fs.unlinkSync(`${audit}.new`);
  restore_batch(fixture_.root, fixture_.batch, runtime); assert.equal(fs.readFileSync(closed, "utf8"), "closed");
});
