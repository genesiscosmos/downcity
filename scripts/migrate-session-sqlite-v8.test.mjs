/**
 * v8 离线迁移的隔离验收：历史版本、来源/附件、全根门禁、租约与发布中断恢复。
 * 所有数据库在随机临时目录，未访问真实数据根，不启动宿主或调用模型。
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash as create_hash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { snapshot_file, target_descriptor, digest, canonical_json } from "./lib/session-v7-database.mjs";
import { preflight, migrate, verify_batch, restore_batch, read_manifest } from "./lib/session-v8-migration.mjs";
import { parse_arguments, run } from "./migrate-session-sqlite-v8.mjs";
import { save_json, load_recovered_sources } from "./lib/session-v8-files.mjs";

const runtime = await load_runtime(true);

test("分块指纹与既有规范 JSON 哈希完全一致", () => {
  for (const value of [null, true, -0, 3.14, "中文\n\"内容", [], {},
    { z: [{ b: 2, a: 1 }, null], a: "x" }, [undefined, , "末尾"],
    { optional: undefined }, { blob: Uint8Array.from({ length: 32 }, (_, index) => index) },
    Array.from({ length: 10000 }, (_, index) => ({ index, text: "会话正文".repeat(20) }))]) {
    assert.equal(digest(value), create_hash("sha256").update(canonical_json(value)).digest("hex"));
  }
});

/** 每次测试独立 root/batch；保持跨卷批次语义但不触碰用户数据。 */
function fixture(context) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v8-test-")));
  const root_path = path.join(directory, "root"); fs.mkdirSync(root_path);
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { root_path, batch_path: path.join(directory, "batch") };
}

/** 用当前字段契约建立旧库，v5/v6 保留 visibility；不通过迁移器生成测试源。 */
function source_database(root_path, options = {}) {
  const { agent_id = "sample", session_id = "main", category = "chat", partition = "sessions", version = 7,
    file = false, internal = false, origin_session_id = null, origin_message_id = null, streaming = false } = options;
  const database_path = path.join(root_path, "agents", agent_id, partition, category, session_id, "session.db");
  fs.mkdirSync(path.dirname(database_path), { recursive: true });
  const database = new DatabaseSync(database_path);
  if (version === 7) database.exec(runtime.SESSION_STORAGE_SCHEMA_SQL);
  else {
    const descriptor = target_descriptor(runtime);
    for (const item of descriptor.schema.filter(item => item.type === "table")) {
      if (version === 5 && item.name === "session_execution_profile") continue;
      let sql = item.sql;
      if (item.name === "messages") sql = sql.replace(/stable_part_sequence INTEGER[\s\S]*?\n  meta TEXT/u, "visibility TEXT NOT NULL,\n  meta TEXT");
      database.exec(sql);
    }
  }
  database.exec(`PRAGMA user_version=${version};`);
  const origin = JSON.stringify({ category, type: category === "chat" ? "agent" : "work" });
  database.prepare(`INSERT INTO session_state(singleton_id,session_id,agent_id,origin,timezone,title,message_count,revision,created_at,updated_at,workspace_id,approval_mode,system_snapshot)
    VALUES(1,?,?,?,'Asia/Shanghai','fixture',1,4,1000,2000,'workspace','ask','system')`).run(session_id, agent_id, origin);
  database.prepare("INSERT INTO session_model_binding VALUES(1,?)").run(JSON.stringify({ default_model_id: null }));
  if (version !== 5) database.prepare("INSERT INTO session_execution_profile VALUES(1,?)").run(JSON.stringify({ id: "test", version: 1, model_id: "saved-model" }));
  const row = { message_id: "m1", turn_id: "t1", sequence: 1, revision: 2, role: streaming ? "agent" : "user", state: streaming ? "streaming" : null,
    ...(version === 7 ? { stable_part_sequence: 0 } : { visibility: internal ? "internal" : "visible" }), meta: null,
    origin_session_id, origin_message_id, origin_turn_id: origin_session_id ? "t1" : null, created_at: 1000, updated_at: 2000 };
  database.prepare(`INSERT INTO messages(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  let content = JSON.stringify(streaming ? { text: "pending", state: "streaming" } : { text: "fixture text" });
  if (file) {
    fs.mkdirSync(path.join(path.dirname(database_path), "attachments"));
    const attachment = path.join(path.dirname(database_path), "attachments", "fixture.txt"); fs.writeFileSync(attachment, "attachment bytes");
    content = JSON.stringify({ media_type: "text/plain", url: attachment, media_version: "version-preserved" });
  }
  database.prepare("INSERT INTO message_parts VALUES('p1','m1',1,NULL,?,?,1000,2000)").run(file ? "file" : "text", content);
  database.close(); return database_path;
}

test("closed CLI rejects missing maintenance declaration, conflicting modes and partial selectors", () => {
  assert.equal(parse_arguments([]).mode, "preflight");
  assert.throws(() => parse_arguments(["--apply", "--batch", "/tmp/batch"]), /writers_stopped_confirmation_required/);
  assert.throws(() => parse_arguments(["--preflight", "--apply"]), /conflicting_modes/);
  assert.throws(() => parse_arguments(["--agent", "sample"]), /unknown_argument/);
});

test("preflight is read-only and host gate rejects the root before execution", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  const before = snapshot_file(source).fingerprint;
  assert.equal(preflight(input.root_path, runtime).status, "planned");
  assert.equal(snapshot_file(source).fingerprint, before);
  assert(!fs.existsSync(input.batch_path)); assert(!fs.existsSync(path.join(input.root_path, runtime.SESSION_STORAGE_MARKER)));
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
});

test("v5/v6/v7 across agents, categories and active/archive preserve full contents and UUID identity", async context => {
  const input = fixture(context);
  const sources = [source_database(input.root_path, { version: 5 }), source_database(input.root_path, { version: 6, partition: "archived-sessions" }),
    source_database(input.root_path, { version: 7, category: "work" }), source_database(input.root_path, { agent_id: "other", version: 6, internal: true })];
  const fingerprints = sources.map(source => snapshot_file(source).fingerprint);
  const result = await migrate(input.root_path, input.batch_path, runtime);
  assert.equal(result.status, "ready"); assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
  await runtime.assert_session_storage_ready(input.root_path);
  assert.deepEqual(sources.map(source => snapshot_file(source).fingerprint), fingerprints);
  const database = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try {
    const records = database.prepare("SELECT * FROM sessions ORDER BY session_key").all();
    assert.equal(records.length, 3); assert.equal(new Set(records.map(row => row.storage_id)).size, 3);
    assert.equal(records.filter(row => row.archived).length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 3);
    assert.equal(database.prepare("SELECT first_business_write_at FROM storage_metadata").get().first_business_write_at, null);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM session_configuration WHERE model_binding=?").get('{"default_model_id":null}').count, 3);
  } finally { database.close(); }
  assert.equal((await migrate(input.root_path, input.batch_path, runtime)).migration_id, result.migration_id);
});

test("fork references are resolved against unique full source identities", async context => {
  const input = fixture(context);
  source_database(input.root_path, { session_id: "parent" });
  source_database(input.root_path, { session_id: "child", origin_session_id: "parent", origin_message_id: "m1" });
  assert.equal((await migrate(input.root_path, input.batch_path, runtime)).status, "ready");
  const database = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try {
    const parent = database.prepare("SELECT storage_id FROM sessions WHERE session_id='parent'").get();
    const child = database.prepare("SELECT origin_storage_id FROM messages WHERE origin_session_id='parent'").get();
    assert.equal(child.origin_storage_id, parent.storage_id);
  } finally { database.close(); }
});

for (const ambiguous of [false, true]) test(`unproven fork source blocks whole batch: ambiguous=${ambiguous}`, async context => {
  const input = fixture(context);
  if (ambiguous) {
    source_database(input.root_path, { session_id: "parent" });
    source_database(input.root_path, { session_id: "parent", partition: "archived-sessions" });
  }
  source_database(input.root_path, { session_id: "child", origin_session_id: "parent", origin_message_id: "m1" });
  const result = await migrate(input.root_path, input.batch_path, runtime);
  assert.equal(result.status, "blocked"); assert.equal(result.agents[0].reason, ambiguous ? "fork_origin_ambiguous" : "fork_origin_missing");
  assert(!fs.existsSync(input.batch_path)); assert(!fs.existsSync(path.join(input.root_path, runtime.SESSION_STORAGE_MARKER)));
});

for (const version of [5, 7]) test(`attachments are copied independently and nested Inbox references rewritten: v${version}`, async context => {
  const input = fixture(context); const source = source_database(input.root_path, { version, file: true, internal: version < 7 });
  const result = await migrate(input.root_path, input.batch_path, runtime); assert.equal(result.status, "ready");
  const database = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  let url;
  try {
    const part = database.prepare("SELECT type,content FROM message_parts").get(); const content = JSON.parse(part.content);
    const file = part.type === "inbox" ? content.content[0] : content;
    url = file.url; assert.equal(file.media_version, "version-preserved");
    assert(url.includes("/session-files/")); assert.equal(fs.readFileSync(url, "utf8"), "attachment bytes");
  } finally { database.close(); }
  const original = path.join(path.dirname(source), "attachments", "fixture.txt");
  assert.notEqual(fs.statSync(url).ino, fs.statSync(original).ino);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
});

test("missing attachments and unknown versions fail closed without publication", context => {
  const input = fixture(context); const source = source_database(input.root_path, { file: true });
  fs.unlinkSync(path.join(path.dirname(source), "attachments", "fixture.txt"));
  const result = preflight(input.root_path, runtime);
  assert.equal(result.agents[0].reason, "attachment_missing");
  const database = new DatabaseSync(source); database.exec("PRAGMA user_version=99"); database.close();
  assert.equal(preflight(input.root_path, runtime).agents[0].reason, "unsupported_schema_version");
});

test("existing target is preserved and blocks an unrelated new batch", async context => {
  const input = fixture(context); source_database(input.root_path);
  await migrate(input.root_path, input.batch_path, runtime);
  const before = snapshot_file(path.join(input.root_path, "agents/sample/sessions.db")).fingerprint;
  const result = await migrate(input.root_path, `${input.batch_path}-other`, runtime);
  assert.equal(result.status, "blocked"); assert.equal(result.agents[0].reason, "existing_target_requires_review");
  assert.equal(snapshot_file(path.join(input.root_path, "agents/sample/sessions.db")).fingerprint, before);
});

for (const point of ["staged", "files", "published", "ready-marker"]) test(`interrupted ${point} publication resumes original UUIDs and keeps gate closed`, async context => {
  const input = fixture(context); source_database(input.root_path);
  const rename = fs.renameSync; let injected = false;
  fs.renameSync = (source, target) => {
    rename(source, target);
    if (injected) return;
    const matched = point === "staged" ? target.endsWith("/sessions.db") && target.includes("/.session-migration-")
      : point === "files" ? target.startsWith(path.join(input.root_path, "agents/sample/session-files/"))
        : point === "published" ? target === path.join(input.root_path, "agents/sample/sessions.db")
          : target === path.join(input.root_path, runtime.SESSION_STORAGE_MARKER) && JSON.parse(fs.readFileSync(target, "utf8")).state === "ready";
    if (matched) { injected = true; throw new Error("injected interruption"); }
  };
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /injected interruption/); }
  finally { fs.renameSync = rename; }
  assert(injected);
  const before = read_manifest(input.batch_path, input.root_path).agents.flatMap(agent => agent.sources.map(source => source.storage_id));
  if (point !== "ready-marker") await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
  const after = await migrate(input.root_path, input.batch_path, runtime);
  assert.deepEqual(after.agents.flatMap(agent => agent.sources.map(source => source.storage_id)), before);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
});

test("source changes after interruption refuse continuation", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  const rename = fs.renameSync;
  fs.renameSync = (from, target) => { rename(from, target); if (target.includes("/.session-migration-") && target.endsWith("/sessions.db")) throw new Error("interrupted"); };
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /interrupted/); }
  finally { fs.renameSync = rename; }
  const database = new DatabaseSync(source); database.exec("UPDATE session_state SET title='changed'"); database.close();
  await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /source_changed_since_preflight/);
});

test("exclusive root lease refuses migration while a host owns storage", async context => {
  const input = fixture(context); source_database(input.root_path);
  const lease = runtime.RootLease.acquire_write(input.root_path);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime)); }
  finally { lease.release(); }
  assert(!fs.existsSync(input.batch_path));
});

test("WAL committed data is backed up and source logical fingerprint stays unchanged", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  const writer = new DatabaseSync(source); writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE session_state SET title='WAL title'");
  try {
    const before = snapshot_file(source).fingerprint;
    const result = await migrate(input.root_path, input.batch_path, runtime); assert.equal(result.status, "ready");
    assert.equal(snapshot_file(source).fingerprint, before);
    assert.equal(snapshot_file(path.join(input.batch_path, "original", result.agents[0].sources[0].relative_path)).tables.session_state[0].title, "WAL title");
  } finally { writer.close(); }
});

test("restore retains target and returns unchanged sources; new runtime remains gated", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  const before = snapshot_file(source).fingerprint;
  await migrate(input.root_path, input.batch_path, runtime);
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime).status, "restored");
  assert.equal(snapshot_file(source).fingerprint, before);
  assert(!fs.existsSync(path.join(input.root_path, "agents/sample/sessions.db")));
  assert(fs.existsSync(path.join(input.batch_path, "retained/sample/sessions.db")));
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
});

test("business write forbids restore of every Agent before any rollback", async context => {
  const input = fixture(context); source_database(input.root_path); source_database(input.root_path, { agent_id: "other" });
  await migrate(input.root_path, input.batch_path, runtime);
  const database = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"));
  database.exec("UPDATE storage_metadata SET first_business_write_at=12345"); database.close();
  assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime), /published_target_changed_or_business_write/);
  assert(fs.existsSync(path.join(input.root_path, "agents/other/sessions.db")));
  assert.equal(read_manifest(input.batch_path, input.root_path).status, "ready");
});

test("new empty roots are ready; pending and malformed markers are rejected", async context => {
  const input = fixture(context); await runtime.assert_session_storage_ready(input.root_path);
  const marker_path = path.join(input.root_path, runtime.SESSION_STORAGE_MARKER);
  fs.writeFileSync(marker_path, '{"format_version":8,"state":"migrating"}');
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
  fs.writeFileSync(marker_path, "invalid"); await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /marker_invalid/);
});

test("valid media disclosure is rebound to independent target file version and stale disclosure stays stale", async context => {
  const input = fixture(context); const source = source_database(input.root_path, { file: true });
  const attachment = path.join(path.dirname(source), "attachments/fixture.txt");
  const source_version = runtime.file_read_version(fs.statSync(attachment));
  const database = new DatabaseSync(source);
  database.prepare("UPDATE message_parts SET content=json_set(content,'$.media_version',?)").run(source_version); database.close();
  await migrate(input.root_path, input.batch_path, runtime);
  const target = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try {
    const content = JSON.parse(target.prepare("SELECT content FROM message_parts").get().content);
    assert.notEqual(content.media_version, source_version);
    assert.equal(content.media_version, runtime.file_read_version(fs.statSync(content.url)));
  } finally { target.close(); }
});

test("an unowned Workspace reference keeps its original path and does not read or copy external bytes", async context => {
  const input = fixture(context); const source = source_database(input.root_path, { file: true });
  const external_path = path.join(path.dirname(input.root_path), "external.pdf");
  const database = new DatabaseSync(source);
  database.prepare("UPDATE message_parts SET content=json_set(content,'$.url',?)").run(external_path); database.close();
  assert.equal((await migrate(input.root_path, input.batch_path, runtime)).status, "ready");
  const target = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try { assert.equal(JSON.parse(target.prepare("SELECT content FROM message_parts").get().content).url, external_path); }
  finally { target.close(); }
  assert(!fs.existsSync(external_path));
});

test("partial attachment copy is verified and continued after interruption", async context => {
  const input = fixture(context); source_database(input.root_path, { file: true });
  const copy = fs.copyFileSync; let injected = false;
  fs.copyFileSync = (from, target, flags) => {
    copy(from, target, flags);
    if (!injected && target.includes("/original/") && from.endsWith("fixture.txt")) { injected = true; throw new Error("copy interrupted"); }
  };
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /copy interrupted/); }
  finally { fs.copyFileSync = copy; }
  assert(injected); assert.equal((await migrate(input.root_path, input.batch_path, runtime)).status, "ready");
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
});

test("restore can continue after published DB removal and is idempotent after completion", async context => {
  const input = fixture(context); source_database(input.root_path);
  await migrate(input.root_path, input.batch_path, runtime);
  const unlink = fs.unlinkSync; let injected = false;
  fs.unlinkSync = target => {
    unlink(target);
    if (!injected && target === path.join(input.root_path, "agents/sample/sessions.db")) { injected = true; throw new Error("restore interrupted"); }
  };
  try { assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime), /restore interrupted/); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime).status, "restored");
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime).status, "restored");
});

test("preflight records all source conversion blockers within one Agent", context => {
  const input = fixture(context);
  for (const session_id of ["one", "two"]) {
    const source = source_database(input.root_path, { session_id });
    const database = new DatabaseSync(source); database.exec("PRAGMA user_version=99"); database.close();
  }
  const result = preflight(input.root_path, runtime);
  assert.equal(result.agents[0].blockers.length, 2);
  assert(result.agents[0].blockers.every(blocker => blocker.reason === "unsupported_schema_version"));
});

test("ready marker cannot authorize a newly added legacy Agent without its target DB", async context => {
  const input = fixture(context); source_database(input.root_path);
  await migrate(input.root_path, input.batch_path, runtime);
  source_database(input.root_path, { agent_id: "late" });
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
});

test("public CLI modes report ready, verified and restored successfully", async context => {
  const input = fixture(context); source_database(input.root_path);
  assert.equal(await run({ ...input, mode: "apply", writers_stopped: true }), 0);
  assert.equal(await run({ ...input, mode: "status" }), 0);
  assert.equal(await run({ ...input, mode: "verify" }), 0);
  assert.equal(await run({ ...input, mode: "restore", writers_stopped: true }), 0);
});

test("reviewed preserved archive resolves a missing fork source without restoring old source partitions", async context => {
  const input = fixture(context); const preserved = fixture(context);
  source_database(input.root_path, { session_id: "child", origin_session_id: "main", origin_message_id: "m1" });
  const archive = source_database(preserved.root_path, { version: 5 });
  assert.equal(preflight(input.root_path, runtime).status, "blocked");
  const recovered_path = path.join(path.dirname(input.root_path), "recovered.json");
  const fingerprint = snapshot_file(archive).fingerprint;
  save_json(recovered_path, { format_version: 1, sources: [{ agent_id: "sample", session_id: "main", category: "chat", database_path: archive,
    source_fingerprint: fingerprint, attachments: [] }] });
  const sources = load_recovered_sources(recovered_path);
  assert.equal(preflight(input.root_path, runtime, new Map(), sources).status, "planned");
  const result = await migrate(input.root_path, input.batch_path, runtime, new Map(), sources);
  assert.equal(result.status, "ready"); assert.equal(result.agents[0].sources.length, 2);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
  assert(!fs.existsSync(path.join(input.root_path, "agents/sample/archived-sessions")));
  const target = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try {
    const archived = target.prepare("SELECT storage_id FROM sessions WHERE archived=1").get();
    assert.equal(target.prepare("SELECT origin_storage_id FROM messages WHERE origin_session_id='main'").get().origin_storage_id, archived.storage_id);
  } finally { target.close(); }
  await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /recovered_sources_manifest_changed/);
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime).status, "restored");
  assert.equal(snapshot_file(archive).fingerprint, fingerprint);
});

test("stale preserved source fingerprint blocks the complete batch", context => {
  const input = fixture(context); const preserved = fixture(context);
  source_database(input.root_path);
  const archive = source_database(preserved.root_path, { session_id: "old" });
  const recovered_path = path.join(path.dirname(input.root_path), "recovered.json");
  save_json(recovered_path, { format_version: 1, sources: [{ agent_id: "sample", session_id: "old", category: "chat", database_path: archive,
    source_fingerprint: "0".repeat(64), attachments: [] }] });
  assert.equal(preflight(input.root_path, runtime, new Map(), load_recovered_sources(recovered_path)).agents[0].reason, "source_changed_since_preflight");
});

test("recovered archive attachments are rebound from preserved absolute paths to original record UUID", async context => {
  const input = fixture(context); const preserved = fixture(context);
  source_database(input.root_path, { session_id: "child" });
  const archive = source_database(preserved.root_path, { file: true });
  const recovered_path = path.join(path.dirname(input.root_path), "recovered.json");
  const { attachment_inventory } = await import("./lib/session-v8-files.mjs");
  save_json(recovered_path, { format_version: 1, sources: [{ agent_id: "sample", session_id: "main", category: "chat", database_path: archive,
    source_fingerprint: snapshot_file(archive).fingerprint, attachments: attachment_inventory(path.join(path.dirname(archive), "attachments")) }] });
  const result = await migrate(input.root_path, input.batch_path, runtime, new Map(), load_recovered_sources(recovered_path));
  assert.equal(result.status, "ready");
  const target = new DatabaseSync(path.join(input.root_path, "agents/sample/sessions.db"), { readOnly: true });
  try {
    const row = target.prepare("SELECT storage_id FROM sessions WHERE archived=1").get();
    const content = JSON.parse(target.prepare("SELECT content FROM message_parts WHERE type='file'").get().content);
    assert.equal(content.url, path.join(input.root_path, "agents/sample/session-files", row.storage_id, "attachments/fixture.txt"));
    assert.equal(fs.readFileSync(content.url, "utf8"), "attachment bytes");
  } finally { target.close(); }
});

test("ENOSPC during attachment bytes is recoverable without changing sources or UUIDs", async context => {
  const input = fixture(context); const source = source_database(input.root_path, { file: true });
  const before = snapshot_file(source).fingerprint;
  const copy = fs.copyFileSync; let injected = false;
  fs.copyFileSync = (from, target, flags) => {
    if (!injected && target.includes("/original/") && from.endsWith("fixture.txt")) {
      injected = true; fs.writeFileSync(target, "partial"); throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    }
    return copy(from, target, flags);
  };
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /disk full/); }
  finally { fs.copyFileSync = copy; }
  const ids = read_manifest(input.batch_path, input.root_path).agents[0].sources.map(source => source.storage_id);
  assert.equal(snapshot_file(source).fingerprint, before);
  const result = await migrate(input.root_path, input.batch_path, runtime);
  assert.deepEqual(result.agents[0].sources.map(source => source.storage_id), ids);
  assert.equal(verify_batch(input.root_path, input.batch_path, runtime).status, "verified");
});

test("space budgets block data and backup volumes before target publication", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  const before = snapshot_file(source).fingerprint;
  const statfs = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 0, bsize: 4096 });
  try {
    assert.equal(preflight(input.root_path, runtime).reason, "insufficient_space");
    assert.equal((await migrate(input.root_path, input.batch_path, runtime)).reason, "insufficient_space");
  } finally { fs.statfsSync = statfs; }
  assert(!fs.existsSync(input.batch_path));
  fs.statfsSync = target => target === path.dirname(input.batch_path) ? { bavail: 0, bsize: 4096 } : statfs(target);
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /insufficient_backup_space/); }
  finally { fs.statfsSync = statfs; }
  assert.equal(snapshot_file(source).fingerprint, before);
  assert(!fs.existsSync(path.join(input.root_path, "agents/sample/sessions.db")));
});

test("restore retained copy interrupted during bytes resumes before removing any target", async context => {
  const input = fixture(context); source_database(input.root_path);
  await migrate(input.root_path, input.batch_path, runtime);
  const target_path = path.join(input.root_path, "agents/sample/sessions.db");
  const before = snapshot_file(target_path).fingerprint;
  const copy = fs.copyFileSync; let injected = false;
  fs.copyFileSync = (from, target, flags) => {
    if (!injected && target.includes("/retained/")) {
      injected = true; fs.writeFileSync(target, "partial"); throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    }
    return copy(from, target, flags);
  };
  try { assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime), /disk full/); }
  finally { fs.copyFileSync = copy; }
  assert(injected); assert.equal(snapshot_file(target_path).fingerprint, before);
  assert.equal(restore_batch(input.root_path, input.batch_path, runtime).status, "restored");
  assert.equal(snapshot_file(path.join(input.batch_path, "retained/sample/sessions.db")).fingerprint, before);
});

test("new legacy source added after interruption cannot be covered by a stale whole-root plan", async context => {
  const input = fixture(context); source_database(input.root_path);
  const rename = fs.renameSync; let injected = false;
  fs.renameSync = (from, target) => {
    rename(from, target);
    if (!injected && target.includes("/.session-migration-") && target.endsWith("sessions.db")) { injected = true; throw new Error("interrupted"); }
  };
  try { await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /interrupted/); }
  finally { fs.renameSync = rename; }
  source_database(input.root_path, { session_id: "late" });
  await assert.rejects(migrate(input.root_path, input.batch_path, runtime), /source_scope_changed/);
  await assert.rejects(runtime.assert_session_storage_ready(input.root_path), /session_migration_required/);
});

test("actual v8 business transaction records first write and rejects restore of the entire batch", async context => {
  const input = fixture(context); source_database(input.root_path); source_database(input.root_path, { agent_id: "other" });
  await migrate(input.root_path, input.batch_path, runtime);
  const { AgentSessionDatabase } = await import("../packages/agent/bin/session/storage/agent-db/AgentSessionDatabase.js");
  const database_path = path.join(input.root_path, "agents/sample/sessions.db");
  const owner = new AgentSessionDatabase({ agent_id: "sample", database_path });
  try {
    owner.write(crypto.randomUUID(), { action: "isolated-configuration-write" }, database => {
      database.exec("UPDATE sessions SET title='business write'"); return { changed: true };
    });
    assert.notEqual(owner.metadata.first_business_write_at, null);
  } finally { owner.close(); }
  assert.throws(() => restore_batch(input.root_path, input.batch_path, runtime), /published_target_changed_or_business_write/);
  assert(fs.existsSync(path.join(input.root_path, "agents/other/sessions.db")));
});

test("corrupt source bytes block apply without initializing or replacing the source", async context => {
  const input = fixture(context); const source = source_database(input.root_path);
  fs.writeFileSync(source, "not a sqlite database".repeat(64));
  const before = fs.readFileSync(source);
  const result = preflight(input.root_path, runtime);
  assert.equal(result.status, "blocked");
  assert.equal((await migrate(input.root_path, input.batch_path, runtime)).status, "blocked");
  assert.deepEqual(fs.readFileSync(source), before);
  assert(!fs.existsSync(input.batch_path));
  assert(!fs.existsSync(path.join(input.root_path, "agents/sample/sessions.db")));
});


test("migrated arbitrary attachment names have exact cleanup ownership and source bytes remain", async context => {
  const input = fixture(context); const source = source_database(input.root_path, { file: true });
  await migrate(input.root_path, input.batch_path, runtime);
  const target_path = path.join(input.root_path, "agents/sample/sessions.db");
  const database = new DatabaseSync(target_path);
  const storage_id = database.prepare("SELECT storage_id FROM sessions").get().storage_id;
  database.exec("PRAGMA foreign_keys=ON; DELETE FROM sessions;"); database.close();
  const { cleanup_agent_session_attachments } = await import("../packages/agent/bin/index.js");
  const result = cleanup_agent_session_attachments({ agent_id: "sample", storage_root_path: path.dirname(target_path) });
  assert.deepEqual(result.completed, [storage_id]);
  assert(fs.existsSync(path.join(path.dirname(source), "attachments/fixture.txt")));
  assert(!fs.existsSync(path.join(path.dirname(target_path), "session-files", storage_id)));
});
