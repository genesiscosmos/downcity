/** @file 验证 SessionStorage 的 SQLite 事务、投影、恢复与 Policy 隔离边界。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteSessionStorage } from "../bin/session/storage/SqliteSessionStorage.js";

/** 创建测试用文件系统协议。 */
function create_files() {
  return {
    ensure_directory: async (directory_path) => await fs.mkdir(directory_path, { recursive: true }),
    file_size: async (file_path) => (await fs.stat(file_path)).size,
  };
}

/** 创建一个文件型 SessionStorage。 */
async function create_storage(directory_path, options = {}) {
  const storage = new SqliteSessionStorage({
    session_id: options.session_id || "session-1",
    agent_id: options.agent_id || "agent-1",
    workspace_id: "workspace-1",
    origin: { type: "chat" },
    database_path: path.join(directory_path, "session.db"),
    database_location: { type: "file" },
    files: create_files(),
    attachments: {},
  });
  await storage.initialize();
  return storage;
}

/** 创建一条 User Message。 */
function create_user_message(state) {
  return {
    message_id: "user-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: state.message_sequence,
    revision: 1,
    role: "user",
    visibility: "visible",
    created_at: 10,
    updated_at: 10,
    parts: [{ part_id: "part-user-1", sequence: 1, type: "text", text: "你好" }],
  };
}

test("Message 与 Part 分表原子保存并刷新列表投影", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const storage = await create_storage(directory_path);
  const created = await storage.create_message(create_user_message);
  assert.equal(created.role, "user");
  const metadata = await storage.read_metadata();
  assert.equal(metadata.message_count, 1);
  assert.equal(metadata.preview_text, "你好");

  const database = new DatabaseSync(path.join(directory_path, "session.db"), { readOnly: true });
  try {
    const message = database.prepare("SELECT role, state FROM messages").get();
    assert.deepEqual({ ...message }, { role: "user", state: null });
    const part = database.prepare("SELECT type, content FROM message_parts").get();
    assert.equal(part.type, "text");
    assert.deepEqual(Object.keys(JSON.parse(part.content)).sort(), ["text"]);
  } finally {
    database.close();
  }

  await assert.rejects(storage.update_message({
    message: { ...created, revision: 3 },
    expected_revision: 2,
    changed_parts: [],
  }), /revision conflict/);
  const updated = {
    ...created,
    revision: 2,
    updated_at: 20,
    parts: [{ ...created.parts[0], text: "你好，SQLite" }],
  };
  await storage.update_message({
    message: updated,
    expected_revision: 1,
    changed_parts: updated.parts,
  });
  assert.equal(updated.parts[0].text, "你好，SQLite");
  assert.equal((await storage.read_metadata()).preview_text, "你好，SQLite");
  await storage.dispose();
});

test("Storage 只查询中断状态，不擅自解释领域恢复语义", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const storage = await create_storage(directory_path);
  await storage.create_message((state) => ({
    message_id: "agent-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: state.message_sequence,
    revision: 1,
    role: "agent",
    state: "streaming",
    visibility: "visible",
    created_at: 10,
    updated_at: 10,
    parts: [
      { part_id: "text-1", sequence: 1, step_id: "step-1", type: "text", text: "部分输出", state: "streaming" },
      { part_id: "tool-1", sequence: 2, step_id: "step-1", type: "tool", tool_call_id: "call-1", tool_name: "read", state: "running" },
      { part_id: "action-1", sequence: 3, type: "action", action_id: "action-1", action_type: "test", state: "running", title: "测试" },
    ],
  }));
  await storage.dispose();

  const reopened = await create_storage(directory_path);
  const [message] = await reopened.list_recoverable_agent_messages();
  assert.equal(message.state, "streaming");
  assert.equal(message.parts[0].state, "streaming");
  assert.equal(message.parts[1].state, "running");
  assert.equal(message.parts[2].state, "running");
  assert.equal((await reopened.read_metadata()).preview_text, "部分输出");
  await reopened.dispose();
});

test("Composer Policy 只能写自己的派生 namespace，clear 触发 FK 清理", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const storage = await create_storage(directory_path);
  await storage.create_message(create_user_message);
  const policy = storage.composer_storage("sequence");
  await policy.transaction((transaction) => {
    transaction.execute("CREATE TABLE composer_sequence_test (message_id TEXT REFERENCES messages(message_id) ON DELETE CASCADE)");
    transaction.execute("INSERT INTO composer_sequence_test (message_id) VALUES (?)", ["user-1"]);
  });
  await assert.rejects(policy.transaction((transaction) => transaction.execute("UPDATE messages SET visibility = 'internal'")), /can only mutate/);
  await assert.rejects(policy.transaction((transaction) => transaction.execute("ALTER TABLE messages ADD COLUMN invalid TEXT")), /cannot execute database control/);
  await assert.rejects(
    policy.transaction((transaction) => transaction.execute(
      "CREATE INDEX composer_sequence_messages_index ON messages(sequence)",
    )),
    /cannot execute database control/,
  );
  await storage.clear_messages();
  assert.equal(await policy.transaction((transaction) => transaction.get("SELECT COUNT(*) AS count FROM composer_sequence_test")).then((row) => row.count), 0);
  assert.equal((await storage.read_metadata()).preview_text, undefined);
  await storage.dispose();
});

test("初始化失败会关闭连接并允许同一实例重试", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const database_path = path.join(directory_path, "session.db");
  const database = new DatabaseSync(database_path);
  database.exec("PRAGMA user_version = 99");
  database.close();
  const storage = new SqliteSessionStorage({
    session_id: "session-1",
    agent_id: "agent-1",
    origin: { type: "chat" },
    database_path,
    database_location: { type: "file" },
    files: create_files(),
    attachments: {},
  });
  await assert.rejects(storage.initialize(), /Unsupported Session schema version/);
  const repair = new DatabaseSync(database_path);
  repair.exec("PRAGMA user_version = 0");
  repair.close();
  await storage.initialize();
  assert.equal((await storage.read_metadata()).session_id, "session-1");
  await storage.dispose();
});

test("旧 SQLite schema 必须由外部脚本迁移", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const database_path = path.join(directory_path, "session.db");
  const database = new DatabaseSync(database_path);
  database.exec("PRAGMA user_version = 1");
  database.close();
  const storage = new SqliteSessionStorage({
    session_id: "session-1",
    agent_id: "agent-1",
    origin: { type: "chat" },
    database_path,
    database_location: { type: "file" },
    files: create_files(),
    attachments: {},
  });
  await assert.rejects(storage.initialize(), /requires the external migration script/);
  await storage.dispose();
});

test("Codec 在损坏的 Part 内容进入领域层前失败", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-storage-"));
  const database_path = path.join(directory_path, "session.db");
  const storage = await create_storage(directory_path);
  await storage.create_message(create_user_message);
  await storage.dispose();

  const database = new DatabaseSync(database_path);
  database.prepare(
    "UPDATE message_parts SET content = ? WHERE part_id = ?",
  ).run(JSON.stringify({ text: 42 }), "part-user-1");
  database.close();

  const reopened = await create_storage(directory_path);
  await assert.rejects(
    reopened.list_messages(),
    /Invalid persisted Session Part part-user-1.*text must be a string/,
  );
  await reopened.dispose();
});
