/** 使用隔离真实数据库验证宿主准备边界；不访问用户根、不启动 Agent 或模型。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { prepare_agent_session_storage, AgentSessionBrowser } from "../bin/index.js";
import { AgentSessionDatabase } from "../bin/session/storage/agent-db/AgentSessionDatabase.js";
import { AgentSessionFileLease } from "../bin/session/storage/agent-db/AgentSessionFileLease.js";

/** 模拟目标格式数据库尚未准备附件协调描述的 Agent。 */
function fixture(context) {
  const storage_root_path = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downcity-session-preparation-")));
  context.after(() => fs.rmSync(storage_root_path, { recursive: true, force: true }));
  const database_path = path.join(storage_root_path, "sessions.db");
  const owner = new AgentSessionDatabase({ agent_id: "sample", database_path, allow_create: true });
  owner.database.prepare("INSERT INTO attachment_cleanup(session_id,requested_at) VALUES(?,1)").run(random_uuid());
  owner.close();
  const lease_path = path.join(storage_root_path, "session-files.lease.db");
  fs.unlinkSync(lease_path);
  return { input: { agent_id: "sample", storage_root_path }, database_path, lease_path };
}

test("已有库缺协调时只读仍拒绝；宿主准备后 Worker 可读且业务库和附件逐字节不变", async context => {
  const f = fixture(context);
  const attachment_path = path.join(f.input.storage_root_path, "session-files", "manual.txt");
  fs.mkdirSync(path.dirname(attachment_path)); fs.writeFileSync(attachment_path, "keep");
  const before = fs.readFileSync(f.database_path);
  assert.throws(() => new AgentSessionDatabase({ agent_id: "sample", database_path: f.database_path, readonly: true }), /coordination_required/);
  assert(!fs.existsSync(f.lease_path));
  prepare_agent_session_storage(f.input);
  const browser = new AgentSessionBrowser(f.input);
  try {
    assert.equal((await browser.list()).total, 0);
    // 已有共享读者时重试准备仍可成功，不能把准备变成独占清理。
    prepare_agent_session_storage(f.input);
  } finally { await browser.dispose(); }
  assert.deepEqual(fs.readFileSync(f.database_path), before);
  assert.equal(fs.readFileSync(attachment_path, "utf8"), "keep");
  const database = new DatabaseSync(f.database_path, { readOnly: true });
  try { assert.equal(database.prepare("SELECT attempts FROM attachment_cleanup").get().attempts, 0); }
  finally { database.close(); }
});

test("中断留下的空协调文件可恢复，协调身份冲突不能覆盖", context => {
  const f = fixture(context);
  fs.writeFileSync(f.lease_path, ""); prepare_agent_session_storage(f.input);
  const lease = new DatabaseSync(f.lease_path);
  lease.prepare("UPDATE file_lease SET identity='foreign'").run(); lease.close();
  const before = fs.readFileSync(f.lease_path);
  assert.throws(() => prepare_agent_session_storage(f.input), /session_attachment_identity_conflict/);
  assert.deepEqual(fs.readFileSync(f.lease_path), before);
});

test("错误业务身份、空库和损坏库均拒绝，不能先生成协调文件", context => {
  const f = fixture(context);
  assert.throws(() => prepare_agent_session_storage({ ...f.input, agent_id: "foreign" }), /session_storage_identity_conflict/);
  assert(!fs.existsSync(f.lease_path));
  for (const content of [Buffer.alloc(0), Buffer.from("not a sqlite database")]) {
    fs.writeFileSync(f.database_path, content);
    assert.throws(() => prepare_agent_session_storage(f.input));
    assert(!fs.existsSync(f.lease_path));
    assert.deepEqual(fs.readFileSync(f.database_path), content);
  }
});

test("缺失库、链接与硬链接均拒绝，不在空 Agent 或外部目录建库", context => {
  const f = fixture(context);
  const original_path = path.join(f.input.storage_root_path, "original.db");
  fs.renameSync(f.database_path, original_path);
  assert.throws(() => prepare_agent_session_storage(f.input), /session_attachment_path_invalid/);
  assert(!fs.existsSync(f.database_path));
  fs.symlinkSync(original_path, f.database_path);
  assert.throws(() => prepare_agent_session_storage(f.input), /session_attachment_path_invalid/);
  fs.unlinkSync(f.database_path); fs.linkSync(original_path, f.database_path);
  assert.throws(() => prepare_agent_session_storage(f.input), /session_attachment_path_invalid/);
  assert(!fs.existsSync(f.lease_path));
});

test("附件维护独占期间准备明确失败，释放后可重试", context => {
  const f = fixture(context); prepare_agent_session_storage(f.input);
  const lease = AgentSessionFileLease.acquire(f.database_path, "sample", true);
  try { assert.throws(() => prepare_agent_session_storage(f.input), /session_attachments_in_use/); }
  finally { lease.release(); }
  prepare_agent_session_storage(f.input);
});
