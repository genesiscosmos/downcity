/**
 * Agent Session 领域维护能力测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { create_workspace_entry } from "../../agent/bin/internal/index.js";
import { Workspace } from "@downcity/city";

function create_project_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-session-maintenance-"));
}

test("Agent sessions 负责清空消息和删除 Session 数据", async () => {
  const root_path = create_project_root();
  const data_root_path = path.join(root_path, "data");
  const agent = new Agent({ id: "agent_test" });
  const entry = create_workspace_entry(agent, new Workspace({
    id: "test_workspace",
    path: root_path,
    data_root_path,
  }));
  try {
    const session = await entry.sessions.create();
    const session_id = session.id;
    await session.append_user_message({ text: "maintenance" });

    assert.equal(
      await entry.sessions.clear_messages(session_id),
      true,
    );

    assert.equal(await entry.sessions.remove(session_id), true);
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
