/** 附件清理真实DB/文件/租约故障演练；全部随机隔离根，不启动宿主或访问用户数据。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { AgentSessionBrowser } from "../bin/session/storage/AgentSessionBrowser.js";
import { AgentSessionDatabase } from "../bin/session/storage/agent-db/AgentSessionDatabase.js";
import { cleanup_agent_session_attachments as cleanup } from "../bin/index.js";
import { RootLease } from "../../city/bin/local/index.js";
import { parse_arguments, run } from "../../../scripts/cleanup-session-attachments.mjs";

/** 所有维护路径显式绑定到本测试root，结束时清理。 */
function fixture(context) {
  const root_path = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-attachment-cleanup-")));
  const storage_root_path = path.join(root_path, "agents", "sample"); fs.mkdirSync(storage_root_path, { recursive: true });
  const database_path = path.join(storage_root_path, "sessions.db");
  const owner = new AgentSessionDatabase({ agent_id: "sample", database_path, allow_create: true });
  context.after(() => { owner.close(); fs.rmSync(root_path, { recursive: true, force: true }); });
  const input = { agent_id: "sample", storage_root_path };
  const record = (archived = false) => {
    const storage_id = random_uuid();
    owner.write(random_uuid(), { action: "create", storage_id }, database => {
      database.prepare(`INSERT INTO sessions(session_id,category,origin,timezone,created_at,updated_at,archived,archived_at)
        VALUES(?,'work','{"category":"work","type":"work"}','UTC',1,1,?,?)`).run(storage_id, archived ? 1 : 0, archived ? 1 : null);
      return {};
    });
    const directory = path.join(storage_root_path, "session-files", storage_id, "attachments");
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "att_0123456789abcdef.txt"), "owned attachment");
    return { storage_id, directory };
  };
  const remove = storage_id => owner.write(random_uuid(), { action: "delete", storage_id }, database => {
    database.prepare("DELETE FROM sessions WHERE session_id=?").run(storage_id); return {};
  });
  const logs = () => {
    const database = new DatabaseSync(database_path, { readOnly: true });
    try { return database.prepare("SELECT * FROM attachment_cleanup ORDER BY session_id").all(); } finally { database.close(); }
  };
  return { input, root_path, database_path, owner, record, remove, logs };
}

test("结构回滚不删附件；提交日志后清理仅原UUID，保留归档/重建与未登记手工目录", context => {
  const f = fixture(context); const archived = f.record(true); const old = f.record();
  f.owner.database.exec("BEGIN; DELETE FROM sessions WHERE archived=0; ROLLBACK;");
  assert.equal(f.logs().length, 0); assert(fs.existsSync(old.directory));
  f.remove(old.storage_id);
  const recreated = f.record();
  const manual = path.join(f.input.storage_root_path, "session-files", random_uuid()); fs.mkdirSync(manual); fs.writeFileSync(path.join(manual, "manual.txt"), "keep");
  f.owner.close();
  const result = cleanup(f.input);
  assert.deepEqual(result.completed, [old.storage_id]); assert.equal(f.logs().length, 0);
  assert(!fs.existsSync(path.dirname(old.directory))); assert(fs.existsSync(archived.directory)); assert(fs.existsSync(recreated.directory)); assert(fs.existsSync(manual));
});

test("读者/导出租约跨Worker占用时拒绝，释放后才可清理", async context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  const reader = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    (async () => { const { AgentSessionDatabase } = await import(workerData.module);
      const reader = new AgentSessionDatabase({ agent_id:'sample', database_path:workerData.path, readonly:true });
      parentPort.postMessage('ready'); parentPort.once('message', () => { reader.close(); parentPort.close(); }); })();`,
    { eval: true, workerData: { path: f.database_path, module: new URL("../bin/session/storage/agent-db/AgentSessionDatabase.js", import.meta.url).href } });
  try {
    await once(reader, "message");
    assert.throws(() => cleanup(f.input), /session_attachments_in_use/);
    assert(fs.existsSync(old.directory)); assert.equal(f.logs()[0].attempts, 0);
  } finally { const exited = once(reader, "exit"); reader.postMessage("release"); await exited; }
  assert.deepEqual(cleanup(f.input).completed, [old.storage_id]);
});

for (const code of ["EACCES", "EIO"]) test(`${code}部分删除失败保留日志与attempts，重试收敛`, context => {
  const f = fixture(context); const old = f.record(); fs.writeFileSync(path.join(old.directory, "att_fedcba9876543210.txt"), "second"); f.remove(old.storage_id); f.owner.close();
  const unlink = fs.unlinkSync; let count = 0;
  fs.unlinkSync = file_path => { if (file_path.startsWith(old.directory) && ++count === 2) throw Object.assign(new Error("private failure"), { code }); return unlink(file_path); };
  let result;
  try { result = cleanup(f.input); } finally { fs.unlinkSync = unlink; }
  assert.equal(result.failed[0].code, code === "EACCES" ? "session_attachment_permission_denied" : "session_attachment_io_failed");
  assert.equal(f.logs()[0].attempts, 1); assert.equal(fs.readdirSync(old.directory).length, 1);
  assert.deepEqual(cleanup(f.input).completed, [old.storage_id]); assert.equal(f.logs().length, 0);
});

test("文件已删但日志结算前失败，下一次按目录不存在幂等完成", context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  const prepare = DatabaseSync.prototype.prepare; let injected = false;
  DatabaseSync.prototype.prepare = function(sql) {
    if (!injected && sql.startsWith("DELETE FROM attachment_cleanup")) { injected = true; throw new Error("interrupted before log ACK"); }
    return prepare.call(this, sql);
  };
  try { assert.equal(cleanup(f.input).failed.length, 1); } finally { DatabaseSync.prototype.prepare = prepare; }
  assert(injected); assert(!fs.existsSync(path.dirname(old.directory))); assert.equal(f.logs()[0].attempts, 1);
  assert.deepEqual(cleanup(f.input).completed, [old.storage_id]); assert.equal(cleanup(f.input).completed.length, 0);
});

test("符号链接/手工根文件/超额目录不触碰外部目标，保留日志", context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  const external = path.join(f.root_path, "outside.txt"); fs.writeFileSync(external, "external");
  const link = path.join(old.directory, "escape.txt"); fs.symlinkSync(external, link);
  assert.equal(cleanup(f.input).failed[0].code, "session_attachment_path_invalid");
  assert.equal(fs.readFileSync(external, "utf8"), "external"); assert(fs.existsSync(path.join(old.directory, "att_0123456789abcdef.txt")));
  fs.unlinkSync(link);
  const hardlink = path.join(old.directory, "att_fedcba9876543210.txt"); fs.linkSync(external, hardlink);
  assert.equal(cleanup(f.input).failed[0].code, "session_attachment_path_invalid");
  assert.equal(fs.readFileSync(external, "utf8"), "external"); fs.unlinkSync(hardlink);
  const held = path.join(f.root_path, "held-attachments"); fs.renameSync(old.directory, held); fs.symlinkSync(held, old.directory);
  assert.equal(cleanup(f.input).failed[0].code, "session_attachment_path_invalid");
  assert(fs.existsSync(path.join(held, "att_0123456789abcdef.txt"))); fs.unlinkSync(old.directory); fs.renameSync(held, old.directory);
  const manual_attachment = path.join(old.directory, "manual.txt"); fs.writeFileSync(manual_attachment, "manual");
  assert.equal(cleanup(f.input).failed[0].code, "session_attachment_unmanaged_files"); assert(fs.existsSync(manual_attachment)); fs.unlinkSync(manual_attachment);
  const manual = path.join(path.dirname(old.directory), "manual.txt"); fs.writeFileSync(manual, "manual");
  assert.equal(cleanup(f.input).failed[0].code, "session_attachment_unmanaged_files"); assert(fs.existsSync(manual)); fs.unlinkSync(manual);
  assert.equal(cleanup({ ...f.input, max_entries: 1 }).failed[0].code, "session_attachment_cleanup_budget_exceeded");
  assert(fs.existsSync(path.join(old.directory, "att_0123456789abcdef.txt"))); assert.equal(cleanup(f.input).remaining, 0);
});

test("Journal中的活动/归档UUID或非法身份不作为垃圾删除，批次有界且失败不饿死健康项", context => {
  const f = fixture(context); const live = f.record(true);
  f.owner.database.prepare("INSERT INTO attachment_cleanup(session_id,requested_at) VALUES(?,0)").run(live.storage_id);
  const old = f.record(); f.remove(old.storage_id); f.owner.close();
  assert.equal(cleanup({ ...f.input, limit: 1 }).failed[0].code, "session_attachment_record_exists");
  assert.deepEqual(cleanup({ ...f.input, limit: 1 }).completed, [old.storage_id]); assert(fs.existsSync(live.directory));
  assert.throws(() => cleanup({ ...f.input, agent_id: "foreign" }), /identity_conflict/);
  const database = new DatabaseSync(f.database_path);
  database.prepare("INSERT INTO attachment_cleanup(session_id,requested_at) VALUES(?,0)").run("x".repeat(36)); database.close();
  assert(cleanup(f.input).failed.some(item => item.code === "session_attachment_identity_invalid"));
});

test("缺少协调描述只读不创建；显式prepare不消费日志；CLI必须精确根/Agent/退出声明", async context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  fs.unlinkSync(path.join(f.input.storage_root_path, "session-files.lease.db"));
  assert.throws(() => new AgentSessionDatabase({ agent_id: "sample", database_path: f.database_path, readonly: true }), /coordination_required/);
  assert(!fs.existsSync(path.join(f.input.storage_root_path, "session-files.lease.db")));
  assert.equal(await run({ root_path: f.root_path, agent_id: "sample", writers_stopped: true, prepare_only: true }), 0);
  assert(fs.existsSync(old.directory)); assert.equal(f.logs()[0].attempts, 0);
  assert.throws(() => parse_arguments(["--root", f.root_path, "--agent", "sample"]), /stopped_required/);
  assert.throws(() => parse_arguments(["--root", f.root_path, "--agent", "..", "--writers-stopped"]), /agent_invalid/);
  assert.equal(await run({ root_path: f.root_path, agent_id: "sample", writers_stopped: true, limit: 1 }), 0);
  assert.equal(f.logs().length, 0);
});


test("根独占维护入口拒绝已有宿主租约，协调准备中断空文件可显式恢复", async context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  const root_lease = RootLease.acquire_write(f.root_path);
  try { await assert.rejects(run({ root_path: f.root_path, agent_id: "sample", writers_stopped: true })); }
  finally { root_lease.release(); }
  assert(fs.existsSync(old.directory)); assert.equal(f.logs()[0].attempts, 0);
  fs.writeFileSync(path.join(f.input.storage_root_path, "session-files.lease.db"), "");
  assert.equal(await run({ root_path: f.root_path, agent_id: "sample", writers_stopped: true, prepare_only: true }), 0);
  assert.equal(cleanup(f.input).remaining, 0);
});


test("真实Browser读取后结构删除可提交，文件清理等待Browser独立租约结束", async context => {
  const f = fixture(context); const old = f.record();
  const browser = new AgentSessionBrowser({ agent_id: "sample", storage_root_path: f.input.storage_root_path });
  try {
    const view = await browser.get(old.storage_id, "work"); assert.equal(view.session_id, old.storage_id);
    f.remove(old.storage_id); f.owner.close();
    assert.equal(f.logs().length, 1); assert(fs.existsSync(old.directory));
    assert.throws(() => cleanup(f.input), /session_attachments_in_use/);
  } finally { await browser.dispose(); }
  assert.deepEqual(cleanup(f.input).completed, [old.storage_id]);
});

test("清理独占区间拒绝新读者进入，完成后读租约可恢复", context => {
  const f = fixture(context); const old = f.record(); f.remove(old.storage_id); f.owner.close();
  const unlink = fs.unlinkSync; let checked = false;
  fs.unlinkSync = target => {
    if (!checked && target.startsWith(old.directory)) {
      checked = true;
      assert.throws(() => new AgentSessionDatabase({ agent_id: "sample", database_path: f.database_path, readonly: true }), /session_attachments_in_use/);
    }
    return unlink(target);
  };
  try { assert.equal(cleanup(f.input).remaining, 0); } finally { fs.unlinkSync = unlink; }
  assert(checked);
  const reader = new AgentSessionDatabase({ agent_id: "sample", database_path: f.database_path, readonly: true }); reader.close();
});

test("清理Worker删除一项后强退，OS释放租约且原日志可重试完成", async context => {
  const f = fixture(context); const old = f.record();
  fs.writeFileSync(path.join(old.directory, "att_fedcba9876543210.txt"), "second"); f.remove(old.storage_id); f.owner.close();
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs');
    (async () => { const { cleanup_agent_session_attachments } = await import(workerData.module);
      const unlink = fs.unlinkSync; let paused = false;
      fs.unlinkSync = target => { unlink(target); if (!paused && target.startsWith(workerData.directory)) {
        paused = true; parentPort.postMessage('partial'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      } };
      cleanup_agent_session_attachments(workerData.input);
    })();`, { eval: true, workerData: { module: new URL("../bin/index.js", import.meta.url).href, directory: old.directory, input: f.input } });
  try {
    await once(worker, "message");
    assert.equal(f.logs()[0].attempts, 1); assert.equal(fs.readdirSync(old.directory).length, 1);
    assert.throws(() => cleanup(f.input), /session_attachments_in_use/);
  } finally { await worker.terminate(); }
  assert.deepEqual(cleanup(f.input).completed, [old.storage_id]); assert.equal(f.logs().length, 0);
});
