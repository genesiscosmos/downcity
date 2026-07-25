/**
 * Agent Session 领域维护能力测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../bin/index.js";

function create_project_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-session-maintenance-"));
}

function get_session_path(root_path, agent_id, session_id) {
  return path.join(
    root_path,
    ".downcity",
    "agents",
    encodeURIComponent(agent_id),
    "sessions",
    encodeURIComponent(session_id),
  );
}

test("Agent sessions 负责清空消息和删除 Session 数据", async () => {
  const root_path = create_project_root();
  const agent = new Agent({
    id: "agent_test",
    workspace: new Workspace({ path: root_path }),
  });
  try {
    await agent.ready();
    const session_id = "session_test";
    await agent.sessions.create({ session_id: session_id });
    const session_path = get_session_path(root_path, agent.id, session_id);
    const messages_path = path.join(session_path, "messages");
    fs.mkdirSync(messages_path, { recursive: true });
    fs.writeFileSync(path.join(messages_path, "active.jsonl"), "{}\n");

    assert.equal(
      await agent.sessions.clear_messages(session_id),
      true,
    );
    assert.equal(fs.existsSync(messages_path), false);
    assert.equal(fs.existsSync(session_path), true);

    assert.equal(await agent.sessions.remove(session_id), true);
    assert.equal(fs.existsSync(session_path), false);
  } finally {
    await agent.dispose();
    fs.rmSync(root_path, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});
