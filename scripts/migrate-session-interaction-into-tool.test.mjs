/** @file 验证旧独立 Interaction Part 并入 Tool Part 的一次性外部迁移。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrate_session_interactions } from "./migrate-session-interaction-into-tool.mjs";

/** 创建一条旧格式 Interaction 的 content。 */
function create_interaction_content({ interaction_id, tool_call_id, source_type = "tool", status = "resolved" }) {
  const content = {
    interaction_id,
    interaction_type: "approval",
    status,
    request: {
      interaction_id,
      turn_id: "turn:session-1:1:aaa",
      type: "approval",
      source: { type: source_type, tool_call_id, tool_name: "shell_exec" },
      title: "Approve shell_exec",
      payload: { cmd: "ls" },
      created_at: 100,
    },
  };
  if (status === "resolved") {
    content.response = { type: "approval", outcome: "resolved", payload: { approved: true } };
    content.resolved_at = 200;
  }
  return content;
}

/** 创建一条旧格式独立 Interaction 的 message_parts 行。 */
function create_legacy_part({ part_id, message_id, sequence, content }) {
  return { part_id, message_id, sequence, type: "interaction", content };
}

/** 创建只包含迁移相关结构的 Session 数据库，并写入给定的 message_parts 行。 */
async function create_database(root_path, parts, message_ids = ["agent-1"]) {
  const session_path = path.join(root_path, "agents", "agent-1", "sessions", "chat", "session-1");
  await fsPromises.mkdir(session_path, { recursive: true });
  const database_path = path.join(session_path, "session.db");
  const database = new DatabaseSync(database_path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_parts (
      part_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      step_id TEXT, type TEXT NOT NULL, content TEXT NOT NULL CHECK (json_valid(content)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(message_id, sequence)
    );
  `);
  const insert_message = database.prepare("INSERT INTO messages VALUES (?, 'agent', 'done', 1, 1)");
  for (const message_id of message_ids) insert_message.run(message_id);
  const insert_part = database.prepare(
    "INSERT INTO message_parts VALUES (?, ?, ?, NULL, ?, ?, 1, 1)",
  );
  for (const part of parts) {
    insert_part.run(part.part_id, part.message_id, part.sequence, part.type, JSON.stringify(part.content));
  }
  database.close();
  return database_path;
}

/** 以只读方式读取单个数据库的 message_parts。 */
function read_parts(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    return database
      .prepare("SELECT part_id, sequence, type, content FROM message_parts ORDER BY sequence")
      .all()
      .map((row) => ({ ...row, content: JSON.parse(row.content) }));
  } finally {
    database.close();
  }
}

/** 构造一个 tool part 行。 */
function tool_part({ part_id, message_id, sequence, tool_call_id }) {
  return {
    part_id,
    message_id,
    sequence,
    type: "tool",
    content: { tool_call_id, tool_name: "shell_exec", state: "completed", input: { cmd: "ls" } },
  };
}

/** 创建带有旧交互行的最小数据库并返回其路径。 */
async function create_legacy_database(root_path, session_name) {
  const session_path = path.join(root_path, "agents", "agent-1", "sessions", "chat", session_name);
  await fsPromises.mkdir(session_path, { recursive: true });
  const database_path = path.join(session_path, "session.db");
  const database = new DatabaseSync(database_path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY, role TEXT NOT NULL, state TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_parts (
      part_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      step_id TEXT, type TEXT NOT NULL, content TEXT NOT NULL CHECK (json_valid(content)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(message_id, sequence)
    );
    INSERT INTO messages VALUES ('agent-1', 'agent', 'done', 1, 1);
  `);
  const insert_part = database.prepare(
    "INSERT INTO message_parts VALUES (?, ?, ?, NULL, ?, ?, 1, 1)",
  );
  insert_part.run("tool:call-1", "agent-1", 2, "tool", JSON.stringify({
    tool_call_id: "call-1", tool_name: "shell_exec", state: "completed",
  }));
  insert_part.run("interaction:interaction:i-1", "agent-1", 3, "interaction", JSON.stringify(
    create_interaction_content({ interaction_id: "interaction:i-1", tool_call_id: "call-1" }),
  ));
  database.close();
  return database_path;
}

test("dry-run 只报告计划，不改库也不产生备份", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-dry-"));
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
    create_legacy_part({
      part_id: "interaction:interaction:i-1",
      message_id: "agent-1",
      sequence: 3,
      content: create_interaction_content({ interaction_id: "interaction:i-1", tool_call_id: "call-1" }),
    }),
  ]);

  const result = await migrate_session_interactions({ root_path, dry_run: true });
  assert.equal(result.migrated_databases, 1);
  assert.equal(result.migrated_interactions, 1);
  assert.equal(result.blocked_databases, 0);
  assert.equal(fs.existsSync(`${database_path}.interactions-v1.bak`), false);
  assert.deepEqual(read_parts(database_path).map((part) => part.type), ["tool", "interaction"]);
  assert.equal(read_parts(database_path)[0].content.interactions, undefined);
});

test("迁移把交互写进所属 Tool Part 并删除旧行，同时留下可独立打开的备份", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-apply-"));
  const part = create_legacy_part({
    part_id: "interaction:interaction:i-1",
    message_id: "agent-1",
    sequence: 3,
    content: create_interaction_content({ interaction_id: "interaction:i-1", tool_call_id: "call-1", source_type: "shell" }),
  });
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
    part,
  ]);

  const result = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(result.migrated_databases, 1);
  assert.equal(result.skipped_databases, 0);

  const parts = read_parts(database_path);
  assert.deepEqual(parts.map((entry) => entry.type), ["tool"]);
  assert.deepEqual(parts[0].content, {
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    state: "completed",
    input: { cmd: "ls" },
    interactions: [create_interaction_content({ interaction_id: "interaction:i-1", tool_call_id: "call-1", source_type: "shell" })],
  });
  // 旧行是 Part，交互不是：身份字段不能进入领域对象。
  for (const key of ["part_id", "sequence", "step_id", "type"]) {
    assert.equal(Object.hasOwn(parts[0].content.interactions[0], key), false);
  }

  const backup_path = `${database_path}.interactions-v1.bak`;
  assert.equal(fs.existsSync(backup_path), true);
  assert.deepEqual(read_parts(backup_path).map((entry) => entry.type), ["tool", "interaction"]);
  assert.equal(read_parts(backup_path)[0].content.interactions, undefined);
});

test("同一 Tool 下的多个交互按原 sequence 排序写入", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-order-"));
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
    create_legacy_part({
      part_id: "interaction:interaction:later",
      message_id: "agent-1",
      sequence: 7,
      content: create_interaction_content({ interaction_id: "interaction:later", tool_call_id: "call-1" }),
    }),
    create_legacy_part({
      part_id: "interaction:interaction:earlier",
      message_id: "agent-1",
      sequence: 4,
      content: create_interaction_content({ interaction_id: "interaction:earlier", tool_call_id: "call-1" }),
    }),
  ]);

  await migrate_session_interactions({ root_path, dry_run: false });
  const tool = read_parts(database_path)[0];
  assert.deepEqual(
    tool.content.interactions.map((entry) => entry.interaction_id),
    ["interaction:earlier", "interaction:later"],
  );
  // 删除后 sequence 留空洞是安全的：排序只依赖剩余关系的相对顺序。
  assert.deepEqual(read_parts(database_path).map((entry) => entry.sequence), [2]);
});

test("跨 message 与跨 Tool 的归属各自独立", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-scope-"));
  const database_path = await create_database(
    root_path,
    [
      tool_part({ part_id: "tool:a", message_id: "agent-1", sequence: 2, tool_call_id: "call-a" }),
      tool_part({ part_id: "tool:b", message_id: "agent-1", sequence: 4, tool_call_id: "call-b" }),
      create_legacy_part({
        part_id: "interaction:interaction:ia",
        message_id: "agent-1",
        sequence: 5,
        content: create_interaction_content({ interaction_id: "interaction:ia", tool_call_id: "call-a" }),
      }),
      create_legacy_part({
        part_id: "interaction:interaction:ib",
        message_id: "agent-1",
        sequence: 6,
        content: create_interaction_content({ interaction_id: "interaction:ib", tool_call_id: "call-b" }),
      }),
      tool_part({ part_id: "tool:c", message_id: "agent-2", sequence: 2, tool_call_id: "call-a" }),
    ],
    ["agent-1", "agent-2"],
  );

  await migrate_session_interactions({ root_path, dry_run: false });
  const parts = read_parts(database_path);
  const by_part_id = new Map(parts.map((entry) => [entry.part_id, entry.content]));
  assert.deepEqual(by_part_id.get("tool:a").interactions.map((entry) => entry.interaction_id), ["interaction:ia"]);
  assert.deepEqual(by_part_id.get("tool:b").interactions.map((entry) => entry.interaction_id), ["interaction:ib"]);
  // 另一条 message 的同名 tool_call_id 不应被误挂。
  assert.equal(by_part_id.get("tool:c").interactions, undefined);
  assert.equal(parts.length, 3);
});

test("归属无法确定时整库阻塞，不写库也不建备份", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-blocked-"));
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
    create_legacy_part({
      part_id: "interaction:interaction:orphan",
      message_id: "agent-1",
      sequence: 3,
      content: create_interaction_content({ interaction_id: "interaction:orphan", tool_call_id: "call-missing" }),
    }),
  ]);

  const result = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(result.blocked_databases, 1);
  assert.equal(result.migrated_databases, 0);
  assert.equal(result.databases[0].unresolved.length, 1);
  assert.match(result.databases[0].unresolved[0].reason, /call-missing/);
  assert.equal(fs.existsSync(`${database_path}.interactions-v1.bak`), false);
  assert.deepEqual(read_parts(database_path).map((entry) => entry.type), ["tool", "interaction"]);
});

test("重复执行只跳过，不重复写入也不覆盖已有备份", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-again-"));
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
    create_legacy_part({
      part_id: "interaction:interaction:i-1",
      message_id: "agent-1",
      sequence: 3,
      content: create_interaction_content({ interaction_id: "interaction:i-1", tool_call_id: "call-1" }),
    }),
  ]);

  await migrate_session_interactions({ root_path, dry_run: false });
  const migrated = read_parts(database_path);
  const first = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(first.skipped_databases, 1);
  assert.equal(first.migrated_databases, 0);
  assert.deepEqual(read_parts(database_path), migrated);
  assert.deepEqual(read_parts(`${database_path}.interactions-v1.bak`).map((entry) => entry.type), ["tool", "interaction"]);
});

test("没有旧行的数据库不产生备份", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-clean-"));
  const database_path = await create_database(root_path, [
    tool_part({ part_id: "tool:call-1", message_id: "agent-1", sequence: 2, tool_call_id: "call-1" }),
  ]);

  const result = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(result.scanned_databases, 1);
  assert.equal(result.skipped_databases, 1);
  assert.equal(result.migrated_interactions, 0);
  assert.equal(fs.existsSync(`${database_path}.interactions-v1.bak`), false);
});

test("单个库被写锁占用时记录失败，不中断其余库的迁移", async () => {
  const root_path = await fsPromises.mkdtemp(path.join(os.tmpdir(), "interaction-into-tool-lock-"));
  const locked_path = await create_legacy_database(root_path, "session-a");
  await create_legacy_database(root_path, "session-b");

  // 模拟 Desktop 正在写入：持有一个排他事务，让迁移拿不到写锁。
  const holder = new DatabaseSync(locked_path);
  holder.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
  let result;
  try {
    result = await migrate_session_interactions({ root_path, dry_run: false });
  } finally {
    holder.exec("ROLLBACK;");
    holder.close();
  }

  assert.equal(result.failed_databases, 1);
  assert.equal(result.migrated_databases, 1);
  assert.equal(result.databases[0].database_path, locked_path);
  assert.equal(result.databases[0].status, "failed");
  assert.match(result.databases[0].error, /lock|busy/i);
  // 失败的库保持原状，后续库照常完成。
  assert.deepEqual(read_parts(locked_path).map((entry) => entry.type), ["tool", "interaction"]);
  assert.deepEqual(
    read_parts(path.join(root_path, "agents", "agent-1", "sessions", "chat", "session-b", "session.db"))
      .map((entry) => entry.type),
    ["tool"],
  );
});
