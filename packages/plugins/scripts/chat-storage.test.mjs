/**
 * Chat Plugin 存储所有权测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatPlugin, clean_chat_storage } from "../bin/index.js";

function create_project_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-chat-storage-"));
}

test("clean_chat_storage 只清理 Chat Plugin 自有数据", async () => {
  const root_path = create_project_root();
  try {
    const session_id = "session_chat";
    const meta_path = path.join(root_path, ".downcity", "channel", "meta.json");
    const chat_dir = path.join(root_path, ".downcity", "chat", session_id);
    const agent_session_dir = path.join(
      root_path,
      ".downcity",
      "agents",
      "agent_test",
      "sessions",
      session_id,
    );
    fs.mkdirSync(path.dirname(meta_path), { recursive: true });
    fs.mkdirSync(chat_dir, { recursive: true });
    fs.mkdirSync(agent_session_dir, { recursive: true });
    fs.writeFileSync(path.join(chat_dir, "history.jsonl"), "{}\n");
    fs.writeFileSync(meta_path, JSON.stringify({
      v: 1,
      updated_at: Date.now(),
      sessionIdByTargetKey: { "telegram|chat_1||": session_id },
      routesBySessionId: {
        [session_id]: {
          v: 1,
          session_id: session_id,
          channel: "telegram",
          chatId: "chat_1",
          updated_at: Date.now(),
        },
      },
    }));

    const result = await clean_chat_storage({
      root_path,
      channel: "telegram",
      chat_id: "chat_1",
    });
    assert.equal(result.session_id, session_id);
    assert.equal(result.removed_chat_dir, true);
    assert.equal(result.removed_route, true);
    assert.equal(fs.existsSync(chat_dir), false);
    assert.equal(fs.existsSync(agent_session_dir), true);
    const meta = JSON.parse(fs.readFileSync(meta_path, "utf8"));
    assert.equal(meta.routesBySessionId[session_id], undefined);
  } finally {
    fs.rmSync(root_path, { recursive: true, force: true });
  }
});

test("chat.history_clear action 只清空事件历史", async () => {
  const root_path = create_project_root();
  try {
    const session_id = "session_history";
    const history_path = path.join(
      root_path,
      ".downcity",
      "chat",
      session_id,
      "history.jsonl",
    );
    fs.mkdirSync(path.dirname(history_path), { recursive: true });
    fs.writeFileSync(history_path, "{}\n");
    const plugin = new ChatPlugin({ channels: [] });
    const result = await plugin.actions.history_clear.execute({
      context: { workspace_path: root_path },
      input: { session_id: session_id },
      plugin_name: "chat",
      action_name: "history_clear",
    });
    assert.equal(result.success, true);
    assert.equal(result.data.cleared, true);
    assert.equal(fs.existsSync(history_path), false);
  } finally {
    fs.rmSync(root_path, { recursive: true, force: true });
  }
});
