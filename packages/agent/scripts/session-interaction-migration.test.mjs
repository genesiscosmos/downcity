/** @file 验证当前 schema 拒绝独立 Interaction，Tool 内嵌交互可完整持久化。 */

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
    path_exists: async (file_path) => await fs.access(file_path).then(() => true, () => false),
    ensure_directory: async (directory_path) => await fs.mkdir(directory_path, { recursive: true }),
    file_size: async (file_path) => (await fs.stat(file_path)).size,
  };
}

/** 创建一个文件型 SessionStorage。 */
async function create_storage(directory_path) {
  const storage = new SqliteSessionStorage({
    session_id: "session-1",
    agent_id: "agent-1",
    workspace_id: "workspace-1",
    origin: { category: "work", type: "work" },
    database_path: path.join(directory_path, "session.db"),
    database_location: { type: "file" },
    files: create_files(),
    attachments: {},
  });
  await storage.initialize();
  return storage;
}

/** 创建一条包含 Tool Part 的 Agent Message。 */
async function create_agent_message(storage) {
  await storage.create_message((state) => ({
    message_id: "agent-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: state.message_sequence,
    revision: 1,
    stable_part_sequence: 0,
    role: "agent",
    state: "done",
    created_at: 10,
    updated_at: 10,
    parts: [
      { part_id: "text-1", sequence: 1, step_id: "step-1", type: "text", text: "执行中", state: "done" },
      {
        part_id: "tool:call-1",
        sequence: 2,
        step_id: "step-1",
        type: "tool",
        tool_call_id: "call-1",
        tool_name: "shell_exec",
        state: "completed",
        input: { cmd: "ls" },
      },
    ],
  }));
}

/** 尝试写入独立 Interaction，验证当前数据库约束。 */
function insert_standalone_interaction(database_path) {
  const database = new DatabaseSync(database_path);
  try {
    database.prepare(
      `INSERT INTO message_parts (part_id, message_id, sequence, step_id, type, content, created_at, updated_at)
       VALUES ('standalone-interaction', 'agent-1', 3, NULL, 'interaction', '{}', 10, 10)`,
    ).run();
  } finally { database.close(); }
}

test("当前 schema 拒绝独立 Interaction，Tool 内嵌交互读回后归属正确", async () => {
  const directory_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-tool-interaction-"));
  const database_path = path.join(directory_path, "session.db");
  const interaction = {
    interaction_id: "interaction:i-1",
    interaction_type: "approval",
    status: "resolved",
    request: {
      interaction_id: "interaction:i-1",
      turn_id: "turn-1",
      type: "approval",
      source: { type: "shell", tool_call_id: "call-1", tool_name: "shell_exec" },
      title: "Approve shell_exec",
      payload: { cmd: "ls" },
      created_at: 100,
    },
    response: { type: "approval", outcome: "resolved", payload: { approved: true } },
    resolved_at: 200,
  };
  const storage = await create_storage(directory_path);
  try {
    await create_agent_message(storage);
    const message = await storage.read_message("agent-1");
    const tool = { ...message.parts[1], interactions: [interaction] };
    await storage.update_message({
      message: { ...message, revision: 2, parts: [message.parts[0], tool] },
      expected_revision: 1, changed_parts: [tool],
    });
  } finally { await storage.dispose(); }
  assert.throws(() => insert_standalone_interaction(database_path), /CHECK constraint failed|incompatible/);
  const reopened = await create_storage(directory_path);
  try {
    const message = await reopened.read_message("agent-1");
    assert.deepEqual(message.parts[1].interactions, [interaction]);
    assert.equal(message.parts[1].tool_call_id, "call-1");
    assert.equal(message.parts.length, 2);
  } finally {
    await reopened.dispose();
    await fs.rm(directory_path, { recursive: true, force: true });
  }
});
