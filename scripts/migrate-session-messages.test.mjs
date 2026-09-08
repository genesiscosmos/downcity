/** @file 验证一次性 Session Message 磁盘迁移脚本。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  migrate_session_message_storage,
} from "./migrate-session-messages.mjs";

test("只迁移 Agent Session messages 目录并可重复执行", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-message-migration-"));
  const messages_path = path.join(
    root_path,
    "agents",
    "test-agent",
    "sessions",
    "chat",
    "test-session",
    "messages",
  );
  await fs.mkdir(path.join(messages_path, "segments"), { recursive: true });
  const base = {
    message_id: "action-1",
    session_id: "test-session",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
  };
  await fs.writeFile(path.join(messages_path, "active.jsonl"), `${JSON.stringify({
    ...base,
    type: "action",
    action_type: "test",
    status: "running",
    title: "Test",
  })}\n`);
  await fs.writeFile(path.join(messages_path, "assistant_message.json"), JSON.stringify({
    ...base,
    message_id: "assistant-2",
    sequence: 2,
    type: "assistant",
    kind: "normal",
    status: "streaming",
    parts: [],
  }));
  const log_messages_path = path.join(root_path, "agents", "test-agent", "logs", "messages");
  await fs.mkdir(log_messages_path, { recursive: true });
  await fs.writeFile(path.join(log_messages_path, "active.jsonl"), "not session data\n");

  const first = await migrate_session_message_storage({ root_path });
  assert.deepEqual(first, {
    scanned_sessions: 1,
    changed_sessions: 1,
    changed_files: 2,
    dry_run: false,
  });
  const active = JSON.parse(await fs.readFile(path.join(messages_path, "active.jsonl"), "utf8"));
  assert.equal(active.type, "agent");
  assert.equal(active.parts[0].type, "action");
  assert.equal(active.parts[0].state, "running");
  assert.equal(await fs.stat(path.join(messages_path, "assistant_message.json")).then(() => true).catch(() => false), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(messages_path, "agent_message.json"), "utf8")).type, "agent");

  const second = await migrate_session_message_storage({ root_path });
  assert.equal(second.changed_sessions, 0);
  assert.equal(second.changed_files, 0);
});

test("dry-run 只报告，不修改磁盘", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-message-migration-"));
  const messages_path = path.join(root_path, "agents", "test-agent", "sessions", "test-session", "messages");
  const active_path = path.join(messages_path, "active.jsonl");
  await fs.mkdir(messages_path, { recursive: true });
  const original = `${JSON.stringify({
    message_id: "error-1",
    session_id: "test-session",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "error",
    scope: "turn",
    code: "test",
    message: "failed",
    recoverable: false,
  })}\n`;
  await fs.writeFile(active_path, original);

  const result = await migrate_session_message_storage({ root_path, dry_run: true });
  assert.equal(result.changed_files, 1);
  assert.equal(await fs.readFile(active_path, "utf8"), original);
});
