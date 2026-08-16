/**
 * @file 验证 SessionStore / SessionDataStore 的领域边界与本地实现契约。
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

test("Workspace provides SessionStore on the same file resource", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({ id: "test_workspace", path: workspace_path });
  const store = workspace.create_session_store("store-test");
  const session_store = store.session("first");

  assert.equal(store.session("first"), session_store);
  assert.equal(await store.has_session("first"), false);

  await session_store.messages.initialize();
  await session_store.write_metadata({
    v: 1,
    session_id: "first",
    agent_id: "store-test",
    created_at: 1,
    updated_at: 1,
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

test("LocalSessionStore archives and cleans sessions", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const store = new Workspace({ id: "test_workspace", path: workspace_path }).create_session_store("archive-test");
  await store.session("archived").messages.initialize();

  const archived = await store.archive_session("archived");
  assert.equal(archived.session_id, "archived");
  assert.equal((await store.list_archived_sessions()).items[0]?.session_id, "archived");
  assert.deepEqual((await store.clean_archive()).removed_session_ids, ["archived"]);
  assert.equal((await store.list_archived_sessions()).items.length, 0);
});

test("Agent obtains its Store from Workspace", async (t) => {
  const { workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({ id: "test_workspace", path: workspace_path });
  const agent = new Agent({ id: "dispose-test" });
  const entry = agent.enter(workspace);

  assert.equal(entry.workspace, workspace);
  assert.equal((await entry.sessions.create({ session_id: "first" })).id, "first");
  await agent.dispose();
});
