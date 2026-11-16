/** 存储错误跨内存与真实 Worker 边界的分类、事务回滚和正文隔离回归。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { AgentSessionDatabase } from "../bin/session/storage/agent-db/AgentSessionDatabase.js";
import { acquire_agent_session_storage } from "../bin/session/storage/agent-db/AgentSessionRuntime.js";
import { AgentSessionStorageError, agent_session_failure } from "../bin/session/storage/agent-db/AgentSessionErrors.js";

test("SQLite 主类别与 extended code 保留，原始正文和 stack 不进入安全响应", () => {
  for (const [sqlite_code, code] of [[5, "busy"], [261, "busy"], [6, "locked"], [8, "readonly"], [10, "io_failed"],
    [11, "corrupt"], [13, "full"], [14, "open_failed"], [275, "constraint_failed"], [26, "not_database"]]) {
    const failure = agent_session_failure(Object.assign(new Error("private SQL and message text"), { code: "ERR_SQLITE_ERROR", errcode: sqlite_code }));
    assert.deepEqual(failure, { code: `session_storage_${code}`, sqlite_code });
  }
  assert.deepEqual(agent_session_failure(new Error("session_not_found: private context")), { code: "session_not_found" });
  assert.deepEqual(agent_session_failure(new Error("private codec text")), { code: "session_storage_transaction_failed" });
  assert.deepEqual(agent_session_failure(Object.assign(new Error("private"), { code: "ERR_SQLITE_ERROR", errcode: "5" })), { code: "session_storage_transaction_failed" });
});

for (const memory of [true, false]) {
  test(`${memory ? "内存" : "文件 Worker"} 约束失败包含安全命令和数字码，回滚后仍可提交`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-error-"));
    const database_path = memory ? ":memory:" : path.join(directory, "sessions.db");
    const lease = await acquire_agent_session_storage({ agent_id: "test", database_path, memory_scope: random_uuid(), allow_create: true }, false);
    const session_id = random_uuid();
    try {
      await lease.write("collection", { command: "create", operation_id: random_uuid(), input: {
        session_id, origin: { category: "work", type: "work" }, timezone: "UTC", created_at: 1,
      } });
      const before = await lease.read({ command: "record", session_id });
      await assert.rejects(lease.write(session_id, { command: "configure", input: {
        operation_id: random_uuid(), session_id, updated_at: 2, approval_mode: "private-invalid-value",
      } }), error => {
        assert.ok(error instanceof AgentSessionStorageError);
        assert.equal(error.message, "session_storage_constraint_failed");
        assert.equal(error.command, "configure"); assert.equal(error.sqlite_code & 0xff, 19);
        assert.equal(JSON.stringify(error).includes("private-invalid-value"), false);
        return true;
      });
      assert.deepEqual(await lease.read({ command: "record", session_id }), before);
      await lease.write(session_id, { command: "configure", input: {
        operation_id: random_uuid(), session_id, updated_at: 3, approval_mode: "ask",
      } });
      assert.equal((await lease.read({ command: "record", session_id })).revision, before.revision + 1);
    } finally { await lease.release(); await fs.rm(directory, { recursive: true, force: true }); }
  });
}

test("真实文件锁争用返回 busy 数字码，仍可只读且不自动重放写入", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-busy-"));
  const database_path = path.join(directory, "sessions.db");
  const owner = new AgentSessionDatabase({ agent_id: "test", database_path, allow_create: true });
  const lease = await acquire_agent_session_storage({ agent_id: "test", database_path }, false);
  const session_id = random_uuid();
  try {
    await lease.write("collection", { command: "create", operation_id: random_uuid(), input: {
      session_id, origin: { category: "work", type: "work" }, timezone: "UTC", created_at: 1,
    } });
    owner.database.exec("BEGIN IMMEDIATE");
    const operation_id = random_uuid();
    try {
      await assert.rejects(lease.write(session_id, { command: "configure", input: { operation_id, session_id, updated_at: 2, title: "changed" } }), error => {
        assert.equal(error.message, "session_storage_busy"); assert.equal(error.command, "configure"); assert.equal(error.sqlite_code & 0xff, 5); return true;
      });
      assert.equal((await lease.read({ command: "record", session_id })).title, null);
    } finally { owner.database.exec("ROLLBACK"); }
    assert.equal(await lease.read({ command: "receipt", operation_id }), null);
    assert.equal((await lease.read({ command: "record", session_id })).title, null);
  } finally { await lease.release(); owner.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("只读配置查询遇到无效数据库时保留命令和数字码，不回显文件正文", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-invalid-"));
  const database_path = path.join(directory, "sessions.db");
  await fs.writeFile(database_path, "private database content which must never cross IPC".repeat(10));
  const lease = await acquire_agent_session_storage({ agent_id: "test", database_path }, true);
  try {
    await assert.rejects(lease.read({ command: "configuration", session_id: random_uuid() }), error => {
      assert.ok(error instanceof AgentSessionStorageError);
      assert.equal(error.message, "session_storage_not_database");
      assert.equal(error.command, "configuration"); assert.equal(error.sqlite_code & 0xff, 26);
      assert.equal(String(error.stack).includes("private database content"), false);
      return true;
    });
  } finally { await lease.release(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("首次只读 schema 探测也等待短暂锁释放，不能在设置 busy_timeout 前立即失败", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-open-lock-"));
  const database_path = path.join(directory, "sessions.db");
  const initial = new AgentSessionDatabase({ agent_id: "test", database_path, allow_create: true });
  initial.close();
  // 使用排他锁稳定覆盖首次 schema 读取；锁在独立线程释放，主线程同步等待不能阻止释放。
  const setup = new DatabaseSync(database_path);
  setup.exec("PRAGMA journal_mode = DELETE"); setup.close();
  const holder = new Worker(`
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const database = new DatabaseSync(workerData.database_path);
    database.exec('BEGIN EXCLUSIVE');
    parentPort.postMessage('locked');
    setTimeout(() => { database.exec('ROLLBACK'); database.close(); }, 150);
  `, { eval: true, workerData: { database_path } });
  let reader;
  try {
    await once(holder, "message");
    reader = new AgentSessionDatabase({ agent_id: "test", database_path, readonly: true });
    assert.equal(reader.metadata.agent_id, "test");
    assert.equal(reader.metadata.first_business_write_at, null);
  } finally { reader?.close(); await holder.terminate(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("已有空DB不得因allow_create被当成全新库初始化", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-empty-existing-"));
  const database_path = path.join(directory, "sessions.db");
  try {
    await fs.writeFile(database_path, "");
    const before = await fs.readFile(database_path);
    assert.throws(() => new AgentSessionDatabase({ agent_id: "test", database_path, allow_create: true }), /session_migration_required/);
    assert.deepEqual(await fs.readFile(database_path), before);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
