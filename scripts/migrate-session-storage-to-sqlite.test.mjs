/** @file 验证旧 Session 文件到 SQLite 的一次性迁移。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrate_session_storage_to_sqlite } from "./lib/session-storage-migration.mjs";

/** 创建旧 Session fixture。 */
async function create_legacy_session(root_path) {
  const session_path = path.join(root_path, "agents", "test-agent", "sessions", "legacy-session");
  const messages_path = path.join(session_path, "messages");
  const segments_path = path.join(messages_path, "segments");
  await fs.mkdir(segments_path, { recursive: true });
  await fs.writeFile(path.join(session_path, "meta.json"), JSON.stringify({
    v: 2,
    session_id: "legacy-session",
    agent_id: "test-agent",
    workspace_id: "workspace-1",
    created_at: 10,
    updated_at: 40,
    timezone: "Asia/Shanghai",
    title: "旧会话",
  }));
  await fs.writeFile(path.join(session_path, "instruction.md"), "你是测试 Agent。\n");
  const base = {
    session_id: "legacy-session",
    visibility: "visible",
    created_at: 10,
    updated_at: 10,
  };
  const user_revision_1 = {
    ...base,
    message_id: "user-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    type: "user",
    input_type: "prompt",
    parts: [{ part_id: "user-text", type: "text", text: "旧文本", state: "done" }],
  };
  const user_revision_2 = {
    ...user_revision_1,
    revision: 2,
    updated_at: 20,
    parts: [{ part_id: "user-text", type: "text", text: "最终文本", state: "done" }],
  };
  const agent = {
    ...base,
    message_id: "agent-2",
    turn_id: "turn-1",
    sequence: 2,
    revision: 1,
    updated_at: 30,
    type: "agent",
    kind: "normal",
    status: "completed",
    parts: [
      { part_id: "reasoning-1", type: "reasoning", text: "思考", state: "done" },
      { part_id: "tool-1", type: "tool", tool_call_id: "call-1", tool_name: "read_file", state: "completed", input: {}, output: {} },
      { part_id: "text-1", type: "text", text: "完成", state: "done" },
    ],
  };
  await fs.writeFile(path.join(segments_path, "000000000001-000000000001.jsonl"), [
    JSON.stringify(user_revision_1),
    JSON.stringify({ record_type: "summary", session_id: "legacy-session", summary_id: "summary-1", through_sequence: 1, text: "历史摘要", created_at: 21 }),
  ].join("\n") + "\n");
  await fs.writeFile(path.join(messages_path, "active.jsonl"), [
    JSON.stringify(user_revision_2),
    JSON.stringify(agent),
  ].join("\n") + "\n");
  return session_path;
}

test("迁移 Message/Part/Summary 并移动到标准来源分区", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-sqlite-"));
  const source_path = await create_legacy_session(root_path);
  const dry_run = await migrate_session_storage_to_sqlite({ root_path, dry_run: true });
  assert.equal(dry_run.migrated_sessions, 1);
  assert.equal(await fs.stat(path.join(source_path, "session.db")).then(() => true).catch(() => false), false);

  const result = await migrate_session_storage_to_sqlite({ root_path, agent_id: "test-agent" });
  assert.equal(result.migrated_sessions, 1);
  const target_path = path.join(root_path, "agents", "test-agent", "sessions", "chat", "legacy-session");
  const database_path = path.join(target_path, "session.db");
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    const state = database.prepare("SELECT * FROM session_state").get();
    assert.equal(state.session_id, "legacy-session");
    assert.equal(state.message_count, 2);
    assert.equal(state.preview_text, "完成");
    assert.equal(state.system_snapshot, "你是测试 Agent。");
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);
    assert.deepEqual(database.prepare("SELECT role, revision, state FROM messages ORDER BY sequence").all().map((row) => ({ ...row })), [
      { role: "user", revision: 2, state: null },
      { role: "agent", revision: 1, state: "done" },
    ]);
    const parts = database.prepare("SELECT sequence, step_id, type, content FROM message_parts WHERE message_id = 'agent-2' ORDER BY sequence").all();
    assert.deepEqual(parts.map((part) => [part.sequence, part.step_id, part.type]), [
      [1, "step:agent-2:1", "reasoning"],
      [2, "step:agent-2:1", "tool"],
      [3, "step:agent-2:2", "text"],
    ]);
    assert.deepEqual(Object.keys(JSON.parse(parts[0].content)).sort(), ["state", "text"]);
    assert.deepEqual({ ...database.prepare("SELECT through_message_id, through_sequence, summary FROM composer_sequence_summaries").get() }, {
      through_message_id: "user-1",
      through_sequence: 1,
      summary: "历史摘要",
    });
  } finally {
    database.close();
  }
  assert.equal(await fs.stat(path.join(target_path, "meta.json")).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(path.join(target_path, "messages")).then(() => true).catch(() => false), false);

  const second = await migrate_session_storage_to_sqlite({ root_path });
  assert.equal(second.migrated_sessions, 0);
  assert.equal(second.skipped_sessions, 1);
});

test("迁移运行中草稿和旧顶层 Action/Error", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-sqlite-"));
  const session_path = path.join(root_path, "agents", "agent-a", "sessions", "chat", "session-a");
  const messages_path = path.join(session_path, "messages");
  await fs.mkdir(messages_path, { recursive: true });
  await fs.writeFile(path.join(session_path, "meta.json"), JSON.stringify({
    session_id: "session-a", agent_id: "agent-a", origin: { type: "chat" }, created_at: 1, updated_at: 1,
  }));
  const base = { session_id: "session-a", revision: 1, visibility: "visible", created_at: 1, updated_at: 1 };
  await fs.writeFile(path.join(messages_path, "active.jsonl"), [
    JSON.stringify({ ...base, message_id: "action-1", sequence: 1, type: "action", action_type: "test", status: "running", title: "测试" }),
    JSON.stringify({ ...base, message_id: "error-2", sequence: 2, type: "error", scope: "turn", code: "E_TEST", message: "失败", recoverable: false }),
  ].join("\n") + "\n");
  await fs.writeFile(path.join(messages_path, "agent_message.json"), JSON.stringify({
    ...base,
    message_id: "agent-3",
    turn_id: "turn-1",
    sequence: 3,
    type: "agent",
    kind: "normal",
    status: "streaming",
    parts: [{ part_id: "text-3", sequence: 1, type: "text", text: "中断", state: "streaming" }],
  }));

  await migrate_session_storage_to_sqlite({ root_path });
  const database = new DatabaseSync(path.join(session_path, "session.db"), { readOnly: true });
  try {
    assert.deepEqual(database.prepare("SELECT role, state FROM messages ORDER BY sequence").all().map((row) => ({ ...row })), [
      { role: "agent", state: "done" },
      { role: "agent", state: "done" },
      { role: "agent", state: "done" },
    ]);
    assert.deepEqual(database.prepare("SELECT type FROM message_parts ORDER BY message_id").all().map((row) => row.type).sort(), ["action", "error", "text"]);
    assert.equal(JSON.parse(database.prepare("SELECT content FROM message_parts WHERE part_id = 'action-1:part:1'").get().content).state, "failed");
    assert.equal(JSON.parse(database.prepare("SELECT content FROM message_parts WHERE part_id = 'agent-3:part:1'").get().content).state, "done");
  } finally {
    database.close();
  }
});
