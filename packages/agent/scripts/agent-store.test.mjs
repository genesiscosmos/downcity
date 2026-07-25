/**
 * @file 验证 AgentStore / SessionStore 的领域边界与本地实现契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../bin/index.js";

async function create_test_roots(t) {
  const parent_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-store-"));
  const workspace_path = path.join(parent_path, "workspace");
  await fs.mkdir(workspace_path);
  t.after(async () => await fs.rm(parent_path, { recursive: true, force: true }));
  return { workspace_path };
}

test("Workspace provides AgentStore on the same file resource", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({ path: workspace_path });
  const store = workspace.bind_agent("store-test");
  const session_store = store.session("first");

  assert.equal(store.session("first"), session_store);
  assert.equal(await store.has_session("first"), false);

  await session_store.messages.initialize();
  await session_store.write_metadata({
    v: 1,
    sessionId: "first",
    agentId: "store-test",
    createdAt: 1,
    updatedAt: 1,
    title: "独立存储",
  });
  await session_store.write_instruction("");

  assert.equal(await store.has_session("first"), true);
  assert.equal((await session_store.read_metadata()).title, "独立存储");
  assert.equal(await session_store.has_instruction(), true);
  assert.equal(await session_store.read_instruction(), "");
  const tool_result = await workspace.files.run_file_action({
    action: "read",
    input: {
      file_path: ".downcity/agents/store-test/sessions/first/messages/meta.json",
    },
  });
  assert.equal(tool_result.success, true);
  assert.match(tool_result.success ? tool_result.content : "", /独立存储/);

  assert.equal(await store.clear_session_messages("first"), true);
  assert.equal((await store.session("first").read_metadata()).title, undefined);
  assert.equal(await store.has_session("first"), true);
  assert.equal(await store.remove_session("first"), true);
  assert.equal(await store.has_session("first"), false);
});

test("LocalAgentStore archives and cleans sessions", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const store = new Workspace({ path: workspace_path }).bind_agent("archive-test");
  await store.session("archived").messages.initialize();

  const archived = await store.archive_session("archived");
  assert.equal(archived.sessionId, "archived");
  assert.equal((await store.list_archived_sessions()).items[0]?.sessionId, "archived");
  assert.deepEqual((await store.clean_archive()).removedSessionIds, ["archived"]);
  assert.equal((await store.list_archived_sessions()).items.length, 0);
});

test("Agent obtains its Store from Workspace", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({ path: workspace_path });
  const agent = new Agent({
    id: "dispose-test",
    workspace,
  });

  assert.equal(agent.workspace, workspace);
  assert.equal((await agent.sessions.create({ sessionId: "first" })).id, "first");
  await agent.dispose();
});
