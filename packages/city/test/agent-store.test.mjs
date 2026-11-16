/**
 * @file 验证 SessionStore / SessionStorage 的领域边界与本地实现契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { Workspace } from "@downcity/city";

async function create_test_roots(t) {
  const parent_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-store-"));
  const workspace_path = path.join(parent_path, "workspace");
  const data_root_path = path.join(parent_path, "platform");
  await fs.mkdir(workspace_path);
  t.after(async () => await fs.rm(parent_path, { recursive: true, force: true }));
  return { data_root_path, workspace_path };
}

test("Agent Session 显式使用 Workspace，同时保持 Agent 级存储所有权", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const agent = new Agent({ id: "dispose-test" });
  const first_session = await agent.sessions.create({ workspace });
  assert.equal(first_session.workspace_id, workspace.id);
  assert.ok(first_session.id);
  await agent.dispose();
});

test("Agent sessions runtime 只解析已加载的 Session", async () => {
  const agent = new Agent({ id: "runtime-lookup-test" });
  try {
    assert.throws(
      () => agent.sessions.runtime("missing-session"),
      /call sessions\.get\(session_id, category\) first/u,
    );
    const session = await agent.sessions.create();
    assert.equal(agent.sessions.runtime(session.id).session_id, session.id);
  } finally {
    await agent.dispose();
  }
});
