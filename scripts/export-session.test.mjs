/**
 * 单 Session 导出隔离验收：同逻辑多记录、源只读、包校验、租约和中断续跑。
 * 所有数据根和输出包都在随机临时目录；不读取真实用户存储、不启动宿主。
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parse_arguments, run } from "./export-session.mjs";
import { export_session, load_package } from "./lib/session-transfer-package.mjs";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { file_hash } from "./lib/session-v8-files.mjs";

const runtime = await load_runtime(true);

/** 建立目标正式 schema 的三条同逻辑记录，不通过导出模块生成源数据。 */
function fixture(context) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-session-export-")));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root_path = path.join(directory, "root");
  const agent_path = path.join(root_path, "agents", "sample");
  fs.mkdirSync(agent_path, { recursive: true });
  const database_path = path.join(agent_path, "sessions.db");
  const database = new DatabaseSync(database_path);
  database.exec("PRAGMA foreign_keys=ON;");
  database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
  database.prepare("INSERT INTO storage_metadata(singleton_id,agent_id,format_version,generation,cursor_secret,created_at) VALUES(1,'sample',8,?,?,1)")
    .run(random_uuid(), random_bytes(32));
  database.exec("PRAGMA user_version=8;");
  const ids = [random_uuid(), random_uuid(), random_uuid()];
  for (const [index, storage_id] of ids.entries()) {
    const attachments = path.join(agent_path, "session-files", storage_id, "attachments");
    fs.mkdirSync(attachments, { recursive: true });
    const attachment = path.join(attachments, "fixture.txt"); fs.writeFileSync(attachment, 'attachment-' + index);
    const key = Number(database.prepare(`INSERT INTO sessions(storage_id,session_id,category,origin,timezone,title,archived,archived_at,message_count,revision,created_at,updated_at)
      VALUES(?,'main','chat',?,'UTC',?,?,?,1,1,1,2)`).run(storage_id,
      JSON.stringify({ category: "chat", type: "agent" }), 'record-' + index, index < 2 ? 1 : 0, index < 2 ? 3 : null).lastInsertRowid);
    database.prepare("UPDATE session_configuration SET system_snapshot=?,model_binding=? WHERE session_key=?")
      .run('system-' + index, JSON.stringify({ default_model_id: null }), key);
    database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,created_at,updated_at) VALUES(?,'message',1,'user',1,2)").run(key);
    database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(?,'file','message',1,'file',?,1,2)")
      .run(key, JSON.stringify({ media_type: "text/plain", url: attachment }));
  }
  database.close();
  runtime.AgentSessionFileLease.acquire(database_path, "sample", false, true).release();
  return { directory, root_path, agent_path, database_path, ids,
    input: { root_path, agent_id: "sample", storage_id: ids[0], operation_id: random_uuid(), package_path: path.join(directory, "package"), writers_stopped: true } };
}

test('CLI has no default root/mode and rejects ambiguous/partial maintenance inputs', () => {
  assert.throws(() => parse_arguments([]), /transfer_mode_and_package_required/);
  assert.throws(() => parse_arguments(['--export', '--verify-package']), /conflicting_modes/);
  assert.throws(() => parse_arguments(['--export', '--package', '/tmp/example']), /explicit_root/);
  assert.throws(() => parse_arguments(['--verify-package', '--package', '/tmp/example', '--root', '/tmp/root']), /unexpected_selector/);
  assert.throws(() => parse_arguments(['--help', '--typo']), /unknown_argument/);
  assert.equal(parse_arguments(['--help']).help, true);
});

test('exports exact UUID, source unchanged, independent package verifies without source', async context => {
  const item = fixture(context);
  const before = file_hash(item.database_path);
  for (const [index, storage_id] of item.ids.entries()) {
    const input = { ...item.input, storage_id, operation_id: random_uuid(), package_path: path.join(item.directory, 'package-' + index) };
    assert.equal((await export_session(input, runtime)).status, 'exported');
    const { record } = load_package(input.package_path, runtime);
    assert.equal(record.metadata.storage_id, storage_id);
    assert.equal(record.metadata.archived, index < 2 ? 1 : 0);
    assert.equal(record.configuration.system_snapshot, 'system-' + index);
    assert.equal(record.messages.length, 1);
    assert.equal(record.message_parts.length, 1);
  }
  assert.equal(file_hash(item.database_path), before);
  fs.renameSync(item.root_path, path.join(item.directory, 'retained-source'));
  assert.equal(await run({ mode: 'verify', package_path: path.join(item.directory, 'package-0') }), 0);
});

test('root ownership/exact identity/outside output enforced and source is not initialized', async context => {
  const item = fixture(context);
  await assert.rejects(export_session({ ...item.input, storage_id: random_uuid() }, runtime), /transfer_session_not_found/);
  await assert.rejects(export_session({ ...item.input, package_path: path.join(item.root_path, 'package') }, runtime), /outside_root/);
  await assert.rejects(export_session({ ...item.input, agent_id: '..' }, runtime), /agent_invalid/);
  const lease = runtime.RootLease.acquire_write(item.root_path);
  try { await assert.rejects(export_session(item.input, runtime)); }
  finally { lease.release(); }
  assert.equal(fs.existsSync(item.input.package_path), false);
});

test('same export operation resumes; different operation or changed source refuses overwrite', async context => {
  const item = fixture(context);
  await export_session(item.input, runtime);
  assert.equal((await export_session(item.input, runtime)).status, 'exported');
  await assert.rejects(export_session({ ...item.input, operation_id: random_uuid() }, runtime), /export_conflict/);
  const database = new DatabaseSync(item.database_path);
  database.prepare('UPDATE sessions SET title=? WHERE storage_id=?').run('changed', item.ids[0]); database.close();
  await assert.rejects(export_session(item.input, runtime), /export_conflict/);
});

test('half-copy ENOSPC can resume original package without publishing a half attachment', async context => {
  const item = fixture(context);
  const original = fs.copyFileSync;
  let failed = false;
  fs.copyFileSync = (source, target, ...options) => {
    if (!failed && target.endsWith('.pending')) {
      failed = true; fs.writeFileSync(target, 'partial'); throw Object.assign(new Error('fixture'), { code: 'ENOSPC' });
    }
    return original(source, target, ...options);
  };
  try { await assert.rejects(export_session(item.input, runtime), error => error.code === 'ENOSPC'); }
  finally { fs.copyFileSync = original; }
  assert.equal(fs.existsSync(path.join(item.input.package_path, 'attachments/fixture.txt')), false);
  assert.throws(() => load_package(item.input.package_path, runtime), /package_invalid/);
  await export_session(item.input, runtime);
  assert.equal(load_package(item.input.package_path, runtime).manifest.status, 'ready');
});

test('file coordination is retained throughout copy; changed/missing/source links block export', async context => {
  const item = fixture(context);
  const original = fs.copyFileSync; let observed = false;
  fs.copyFileSync = (source, target, ...options) => {
    assert.throws(() => runtime.AgentSessionFileLease.acquire(item.database_path, 'sample', true));
    observed = true; return original(source, target, ...options);
  };
  try { await export_session(item.input, runtime); }
  finally { fs.copyFileSync = original; }
  assert.equal(observed, true);
  runtime.AgentSessionFileLease.acquire(item.database_path, 'sample', true).release();
  const source = path.join(item.agent_path, 'session-files', item.ids[0], 'attachments/fixture.txt');
  fs.unlinkSync(source);
  await assert.rejects(export_session({ ...item.input, package_path: path.join(item.directory, 'missing') }, runtime), /attachment_missing/);
  fs.symlinkSync(path.join(item.database_path), source);
  await assert.rejects(export_session({ ...item.input, package_path: path.join(item.directory, 'linked') }, runtime), /unsafe_storage_path/);
});

test('unfinished subtree archive cannot be exported without its persisted plan', async context => {
  const item = fixture(context);
  const database = new DatabaseSync(item.database_path);
  const operation_id = random_uuid();
  database.prepare("INSERT INTO archive_operations(operation_id,root_storage_id,session_id,category,fingerprint,created_at) VALUES(?,?,'main','chat',?,1)")
    .run(operation_id, item.ids[0], 'a'.repeat(64));
  database.prepare("INSERT INTO archive_operation_nodes(operation_id,position,storage_id,session_id,category,origin_type) VALUES(?,1,?,'main','chat','agent')")
    .run(operation_id, item.ids[0]); database.close();
  await assert.rejects(export_session(item.input, runtime), /pending_archive_conflict/);
  assert.equal(fs.existsSync(item.input.package_path), false);
});

test('modified body, attachments, unexpected files and linked package are rejected', async context => {
  const item = fixture(context);
  await export_session(item.input, runtime);
  const record_path = path.join(item.input.package_path, 'record.json');
  const original_record = fs.readFileSync(record_path);
  const record = JSON.parse(original_record); record.metadata.title = 'tamper';
  fs.writeFileSync(record_path, JSON.stringify(record));
  assert.throws(() => load_package(item.input.package_path, runtime), /package_invalid/);
  fs.writeFileSync(record_path, original_record);
  fs.writeFileSync(path.join(item.input.package_path, 'unexpected'), 'x');
  assert.throws(() => load_package(item.input.package_path, runtime), /unknown_files/);
  fs.unlinkSync(path.join(item.input.package_path, 'unexpected'));
  fs.writeFileSync(path.join(item.input.package_path, 'attachments/fixture.txt'), 'changed');
  assert.throws(() => load_package(item.input.package_path, runtime), /attachments_changed/);
  const link = path.join(item.directory, 'link'); fs.symlinkSync(item.input.package_path, link);
  assert.throws(() => load_package(link, runtime), /unsafe_storage_path/);
});
