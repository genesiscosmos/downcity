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
  const data_root_path = path.join(parent_path, "platform");
  await fs.mkdir(workspace_path);
  t.after(async () => await fs.rm(parent_path, { recursive: true, force: true }));
  return { data_root_path, workspace_path };
}

test("Workspace provides SessionStore through private AgentWorkspace storage", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const storage = workspace.create_agent_workspace_storage("store-test");
  const store = storage.sessions;
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
  const tool_result = await storage.files.run_file_action({
    action: "read",
    input: {
      file_path: "sessions/first/messages/meta.json",
    },
  });
  assert.equal(tool_result.success, true);
  assert.match(tool_result.success ? tool_result.content : "", /独立存储/);
  assert.equal(await fs.access(path.join(workspace_path, ".downcity")).then(() => true).catch(() => false), false);
  assert.equal((await fs.stat(storage.root_path)).mode & 0o777, 0o700);
  assert.equal(
    (await fs.stat(path.join(storage.root_path, "sessions", "first", "messages", "meta.json"))).mode & 0o777,
    0o600,
  );

  assert.equal(await store.clear_session_messages("first"), true);
  assert.equal((await store.session("first").read_metadata()).title, undefined);
  assert.equal(await store.has_session("first"), true);
  assert.equal(await store.remove_session("first"), true);
  assert.equal(await store.has_session("first"), false);
});

test("LocalSessionStore archives and cleans sessions", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const store = workspace.create_agent_workspace_storage("archive-test").sessions;
  await store.session("archived").messages.initialize();

  const archived = await store.archive_session("archived");
  assert.equal(archived.session_id, "archived");
  assert.equal((await store.list_archived_sessions()).items[0]?.session_id, "archived");
  assert.deepEqual((await store.clean_archive()).removed_session_ids, ["archived"]);
  assert.equal((await store.list_archived_sessions()).items.length, 0);
});

test("AgentWorkspace obtains its Store from private Workspace storage", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const agent = new Agent({ id: "dispose-test" });
  const entry = agent.enter(workspace);

  assert.equal(entry.workspace, workspace);
  assert.equal((await entry.sessions.create({ session_id: "first" })).id, "first");
  await agent.dispose();
});
