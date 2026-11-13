/** 单记录导入的隔离故障验收；正式schema、独立根、精确UUID，不触碰在线存储。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parse_arguments } from "./import-session.mjs";
import { export_session } from "./lib/session-transfer-package.mjs";
import { import_session } from "./lib/session-transfer-import.mjs";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { file_hash, attachment_inventory } from "./lib/session-v8-files.mjs";
import { read_record } from "./lib/session-transfer-record.mjs";

const runtime = await load_runtime(true);

/** 在随机源/目标根建正式schema；目标没有任何记录，导入不得自行迁移或初始化库。 */
async function fixture(context, archived = false, origin_uuid = null) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'downcity-session-import-')));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storage_id = random_uuid();
  const create_database = name => {
    const root = path.join(directory, name);
    const agent_path = path.join(root, 'agents/sample'); fs.mkdirSync(agent_path, { recursive: true });
    const filename = path.join(agent_path, 'sessions.db');
    const database = new DatabaseSync(filename);
    database.exec('PRAGMA foreign_keys=ON;'); database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    database.prepare("INSERT INTO storage_metadata(singleton_id,agent_id,format_version,generation,cursor_secret,created_at) VALUES(1,'sample',8,?,?,1)").run(random_uuid(), random_bytes(32));
    database.exec('PRAGMA user_version=8;');
    return { root, filename, database };
  };
  const source = create_database('source'); const target = create_database('target');
  const attachment_path = path.join(path.dirname(source.filename), 'session-files', storage_id, 'attachments/file.txt');
  fs.mkdirSync(path.dirname(attachment_path), { recursive: true }); fs.writeFileSync(attachment_path, 'owned bytes');
  const key = Number(source.database.prepare(`INSERT INTO sessions(storage_id,session_id,category,origin,timezone,archived,archived_at,message_count,created_at,updated_at)
    VALUES(?,'main','chat',?,'UTC',?,?,1,1,2)`).run(storage_id, JSON.stringify({ category: 'chat', type: 'agent' }), archived ? 1 : 0, archived ? 3 : null).lastInsertRowid);
  source.database.prepare('UPDATE session_configuration SET system_snapshot=? WHERE session_key=?').run('original system', key);
  source.database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,origin_storage_id,origin_session_id,origin_message_id,created_at,updated_at) VALUES(?,'m1',1,'user',?,?,?,1,2)")
    .run(key, origin_uuid, origin_uuid ? 'old' : null, origin_uuid ? 'source-message' : null);
  source.database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,type,content,created_at,updated_at) VALUES(?,'p1','m1',1,'file',?,1,2)")
    .run(key, JSON.stringify({ media_type: 'text/plain', url: attachment_path }));
  source.database.close(); target.database.close();
  for (const filename of [source.filename, target.filename]) runtime.AgentSessionFileLease.acquire(filename, 'sample', false, true).release();
  const package_path = path.join(directory, 'package');
  const export_input = { root_path: source.root, agent_id: 'sample', storage_id, operation_id: random_uuid(), package_path, writers_stopped: true };
  await export_session(export_input, runtime);
  const input = { root_path: target.root, agent_id: 'sample', package_path, batch_path: path.join(directory, 'batch'), operation_id: random_uuid(), writers_stopped: true };
  return { directory, source, target, input, export_input, storage_id };
}

/** 读取目标只观察状态，不调用执行器、自动迁移或维护副作用。 */
function target_record(item) {
  const database = new DatabaseSync(item.target.filename, { readOnly: true });
  try { return read_record(database, item.storage_id); } finally { database.close(); }
}

test('CLI requires explicit root, target, batch, original operation and stopped writers', () => {
  assert.throws(() => parse_arguments([]), /explicit_parameters/);
  assert.throws(() => parse_arguments(['--root', '/tmp/root', '--agent', 'sample']), /explicit_parameters/);
  assert.throws(() => parse_arguments(['--overwrite']), /unknown_argument/);
  assert.equal(parse_arguments(['--help']).help, true);
});

test('imports full exact record and copied attachments, replays original receipt once', async context => {
  const item = await fixture(context);
  const source_hash = file_hash(item.source.filename);
  const result = await import_session(item.input, runtime);
  assert.equal(result.replayed, false);
  const record = target_record(item);
  assert.equal(record.metadata.storage_id, item.storage_id);
  assert.equal(record.configuration.system_snapshot, 'original system');
  assert.equal(record.messages.length, 1);
  const url = JSON.parse(record.message_parts[0].content).url;
  assert.equal(url, path.join(path.dirname(item.target.filename), 'session-files', item.storage_id, 'attachments/file.txt'));
  assert.equal(fs.readFileSync(url, 'utf8'), 'owned bytes');
  assert.equal((await import_session(item.input, runtime)).replayed, true);
  assert.equal(target_record(item).messages.length, 1);
  assert.equal(file_hash(item.source.filename), source_hash);
  const database = new DatabaseSync(item.target.filename, { readOnly: true });
  assert.ok(database.prepare('SELECT first_business_write_at FROM storage_metadata').get().first_business_write_at);
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0); database.close();
});

test('UUID conflict and active logical conflict refuse overwrite; archived same logical ID remains valid', async context => {
  const item = await fixture(context);
  await import_session(item.input, runtime);
  await assert.rejects(import_session({ ...item.input, operation_id: random_uuid(), batch_path: path.join(item.directory, 'new-batch') }, runtime), /storage_id_conflict/);
  const second = await fixture(context, true);
  const database = new DatabaseSync(second.target.filename);
  database.prepare(`INSERT INTO sessions(storage_id,session_id,category,origin,timezone,created_at,updated_at) VALUES(?,'main','chat',?,'UTC',1,2)`)
    .run(random_uuid(), JSON.stringify({ category: 'chat', type: 'agent' })); database.close();
  await import_session(second.input, runtime);
  assert.equal(target_record(second).metadata.archived, 1);
  const third = await fixture(context);
  const conflict = new DatabaseSync(third.target.filename);
  conflict.prepare(`INSERT INTO sessions(storage_id,session_id,category,origin,timezone,created_at,updated_at) VALUES(?,'main','chat',?,'UTC',1,2)`)
    .run(random_uuid(), JSON.stringify({ category: 'chat', type: 'agent' })); conflict.close();
  await assert.rejects(import_session(third.input, runtime), /active_address_conflict/);
});

test('same Agent only; held reader and unknown preexisting target files refuse import', async context => {
  const item = await fixture(context);
  await assert.rejects(import_session({ ...item.input, agent_id: 'other' }, runtime), /agent_identity_conflict/);
  const lease = runtime.AgentSessionFileLease.acquire(item.target.filename, 'sample');
  try { await assert.rejects(import_session(item.input, runtime), /attachments_in_use/); }
  finally { lease.release(); }
  const directory = path.join(path.dirname(item.target.filename), 'session-files', item.storage_id);
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'personal'), 'keep');
  await assert.rejects(import_session(item.input, runtime), /target_files_conflict/);
  assert.equal(fs.readFileSync(path.join(directory, 'personal'), 'utf8'), 'keep');
});

test('half attachment copy and rename-before-manifest failure resume same plan', async context => {
  const item = await fixture(context);
  const original_copy = fs.copyFileSync; let failed = false;
  fs.copyFileSync = (source, target, ...options) => {
    if (!failed && target.endsWith('.pending')) { failed = true; fs.writeFileSync(target, 'partial'); throw Object.assign(new Error('fixture'), { code: 'ENOSPC' }); }
    return original_copy(source, target, ...options);
  };
  try { await assert.rejects(import_session(item.input, runtime), error => error.code === 'ENOSPC'); }
  finally { fs.copyFileSync = original_copy; }
  assert.throws(() => target_record(item), /not_found/);
  const original_rename = fs.renameSync; let interrupted = false;
  fs.renameSync = (source, target) => {
    original_rename(source, target);
    if (!interrupted && source.endsWith('/record')) { interrupted = true; throw new Error('fixture_after_files_publish'); }
  };
  try { await assert.rejects(import_session(item.input, runtime), /fixture_after_files_publish/); }
  finally { fs.renameSync = original_rename; }
  assert.throws(() => target_record(item), /not_found/);
  assert.equal((await import_session(item.input, runtime)).status, 'imported');
});

test('commit acknowledgment loss reconciles same receipt without duplicated messages', async context => {
  const item = await fixture(context);
  const original = DatabaseSync.prototype.exec; let failed = false;
  DatabaseSync.prototype.exec = function (sql) {
    const result = original.call(this, sql);
    if (!failed && sql === 'COMMIT;') { failed = true; throw new Error('fixture_lost_commit_ack'); }
    return result;
  };
  try { await assert.rejects(import_session(item.input, runtime), /lost_commit_ack/); }
  finally { DatabaseSync.prototype.exec = original; }
  assert.equal(target_record(item).messages.length, 1);
  assert.equal((await import_session(item.input, runtime)).replayed, true);
  await assert.rejects(import_session({ ...item.input, operation_id: random_uuid() }, runtime), /batch_conflict/);
});

test('unresolved fork source requires explicit policy; stable UUID is never rebound by logical ID', async context => {
  const origin_uuid = random_uuid();
  const item = await fixture(context, false, origin_uuid);
  const new_package = path.join(item.directory, 'fork-package');
  await export_session({ ...item.export_input, package_path: new_package, operation_id: random_uuid() }, runtime);
  item.input.package_path = new_package;
  await assert.rejects(import_session(item.input, runtime), /external_sources_unresolved/);
  const result = await import_session({ ...item.input, allow_unresolved_sources: true }, runtime);
  assert.equal(result.unresolved_sources, 1);
  assert.equal(target_record(item).messages[0].origin_storage_id, origin_uuid);
});

test('Composer boundary, stable Tool prefix and local ResultRef survive exact transfer', async context => {
  const item = await fixture(context);
  const database = new DatabaseSync(item.source.filename);
  const key = database.prepare('SELECT session_key FROM sessions WHERE storage_id=?').get(item.storage_id).session_key;
  database.prepare("INSERT INTO composer_checkpoints VALUES(?,'default','checkpoint','m1',1,1,'summary',1,3)").run(key);
  database.prepare("INSERT INTO messages(session_key,message_id,sequence,role,state,created_at,updated_at) VALUES(?,'m2',2,'agent','done',3,4)").run(key);
  const output = { success: true, value: 'immutable tool output' };
  const reference = runtime.create_result_ref({ storage_id: item.storage_id, session_id: 'main', category: 'chat', message_id: 'm2', message_sequence: 2, part_id: 'tool' }, output);
  database.prepare("INSERT INTO message_parts(session_key,part_id,message_id,sequence,step_id,type,content,created_at,updated_at) VALUES(?,'tool','m2',1,'step','tool',?,3,4)")
    .run(key, JSON.stringify({ tool_call_id: 'call', tool_name: 'fixture', state: 'completed', input: {}, output, result_ref: reference }));
  database.prepare("UPDATE messages SET stable_part_sequence=1 WHERE session_key=? AND message_id='m2'").run(key);
  database.prepare('UPDATE sessions SET message_count=2 WHERE session_key=?').run(key);
  database.close();
  const package_path = path.join(item.directory, 'tool-package');
  await export_session({ ...item.export_input, package_path, operation_id: random_uuid() }, runtime);
  const result = await import_session({ ...item.input, package_path }, runtime);
  assert.equal(result.unresolved_sources, 0);
  const record = target_record(item);
  assert.equal(record.composer_checkpoints[0].summary, 'summary');
  assert.equal(record.messages[1].stable_part_sequence, 1);
  assert.equal(JSON.parse(record.message_parts.find(part => part.part_id === 'tool').content).result_ref, reference);
});

test('deleted historical UUID cannot be resurrected under a new operation after cleanup', async context => {
  const item = await fixture(context);
  await import_session(item.input, runtime);
  const database = new DatabaseSync(item.target.filename); database.exec('PRAGMA foreign_keys=ON;');
  database.prepare('DELETE FROM sessions WHERE storage_id=?').run(item.storage_id);
  database.prepare('DELETE FROM attachment_cleanup WHERE storage_id=?').run(item.storage_id); database.close();
  fs.rmSync(path.join(path.dirname(item.target.filename), 'session-files', item.storage_id), { recursive: true });
  await assert.rejects(import_session({ ...item.input, operation_id: random_uuid(), batch_path: path.join(item.directory, 'retry-new-batch') }, runtime), /historical_identity_conflict/);
});

test('damaged package, changed policy and deleted committed target cannot be silently reimported', async context => {
  const item = await fixture(context);
  fs.writeFileSync(path.join(item.input.package_path, 'attachments/file.txt'), 'changed');
  await assert.rejects(import_session(item.input, runtime), /attachments_changed/);
  assert.throws(() => target_record(item), /not_found/);
  const other = await fixture(context);
  await import_session(other.input, runtime);
  await assert.rejects(import_session({ ...other.input, allow_unresolved_sources: true }, runtime), /batch_conflict/);
  const database = new DatabaseSync(other.target.filename); database.exec('PRAGMA foreign_keys=ON;');
  database.prepare('DELETE FROM sessions WHERE storage_id=?').run(other.storage_id); database.close();
  await assert.rejects(import_session(other.input, runtime), /not_found/);
});
