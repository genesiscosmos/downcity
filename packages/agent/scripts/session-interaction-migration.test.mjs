/** @file 验证旧格式 Interaction 数据经外部迁移后能被当前编解码读回。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrate_session_interactions } from "../../../scripts/migrate-session-interaction-into-tool.mjs";
import { SqliteSessionStorage } from "../bin/session/storage/SqliteSessionStorage.js";

/** 创建测试用文件系统协议。 */
function create_files() {
  return {
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
    origin: { type: "chat" },
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
    role: "agent",
    state: "done",
    visibility: "visible",
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

/** 以旧格式写入一条独立 Interaction 行，模拟迁移前的磁盘状态。 */
function insert_legacy_interaction(database_path, sequence) {
  const database = new DatabaseSync(database_path);
  try {
    database.prepare(
      `INSERT INTO message_parts (part_id, message_id, sequence, step_id, type, content, created_at, updated_at)
       VALUES (?, 'agent-1', ?, NULL, 'interaction', ?, 10, 10)`,
    ).run(
      "interaction:interaction:i-1",
      sequence,
      JSON.stringify({
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
      }),
    );
  } finally {
    database.close();
  }
}

test("旧格式交互在迁移前不可读，迁移后可读且归属正确", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-interaction-migration-"));
  const directory_path = path.join(root_path, "agents", "agent-1", "sessions", "chat", "session-1");
  const database_path = path.join(directory_path, "session.db");

  const storage = await create_storage(directory_path);
  await create_agent_message(storage);
  await storage.dispose();

  insert_legacy_interaction(database_path, 3);
  const legacy = await create_storage(directory_path);
  // 迁移前的磁盘状态就是用户会话失败时的状态：编解码拒绝整条 message。
  await assert.rejects(
    legacy.list_messages(),
    /legacy standalone Interaction Part requires migration into its Tool Part/,
  );
  await legacy.dispose();

  const result = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(result.migrated_databases, 1);
  assert.equal(result.migrated_interactions, 1);
  assert.equal(result.blocked_databases, 0);

  const migrated = await create_storage(directory_path);
  const messages = await migrated.list_messages();
  await migrated.dispose();
  const tool_part = messages.flatMap((message) => message.parts).find((part) => part.type === "tool");
  assert.deepEqual(tool_part.interactions, [{
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
  }]);

  // 重跑必须无副作用，否则脚本无法安全地重复执行。
  const again = await migrate_session_interactions({ root_path, dry_run: false });
  assert.equal(again.skipped_databases, 1);
  assert.equal(again.migrated_databases, 0);
});
