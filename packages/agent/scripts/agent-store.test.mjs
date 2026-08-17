/**
 * @file 验证 SessionStore / SessionDataStore 的领域边界与本地实现契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../bin/index.js";
import { Workspace } from "@downcity/workspace";
import { LocalSessionStore } from "../bin/workspace/store/LocalSessionStore.js";

/** 由 Agent 领域在 Workspace 通用作用域上创建 SessionStore。 */
function create_agent_storage(workspace, agent_id) {
  const scope = workspace.storage.open_scope([
    "agents",
    agent_id,
    "workspaces",
    workspace.id,
  ]);
  return {
    root_path: scope.root_path,
    files: scope.files,
    sessions: new LocalSessionStore({
      files: scope.files,
      storage_root_path: scope.root_path,
      agent_id,
      workspace_id: workspace.id,
    }),
  };
}

async function create_test_roots(t) {
  const parent_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-store-"));
  const workspace_path = path.join(parent_path, "workspace");
  const data_root_path = path.join(parent_path, "platform");
  await fs.mkdir(workspace_path);
  t.after(async () => await fs.rm(parent_path, { recursive: true, force: true }));
  return { data_root_path, workspace_path };
}

test("Agent creates SessionStore on the Workspace private storage scope", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const storage = create_agent_storage(workspace, "store-test");
  const store = storage.sessions;
  const session_store = store.session("first");

  assert.equal(store.session("first"), session_store);
  assert.equal(await store.has_session("first"), false);

  await session_store.messages.initialize();
  await session_store.write_metadata({
    v: 1,
    session_id: "first",
    agent_id: "store-test",
    workspace_id: "test_workspace",
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
      file_path: "sessions/first/meta.json",
    },
  });
  assert.equal(tool_result.success, true);
  assert.match(tool_result.success ? tool_result.content : "", /独立存储/);
  assert.equal(await fs.access(path.join(workspace_path, ".downcity")).then(() => true).catch(() => false), false);
  assert.equal((await fs.stat(storage.root_path)).mode & 0o777, 0o700);
  assert.equal(
    (await fs.stat(path.join(storage.root_path, "sessions", "first", "meta.json"))).mode & 0o777,
    0o600,
  );

  assert.equal(await store.clear_session_messages("first"), true);
  assert.equal((await store.session("first").read_metadata()).title, "独立存储");
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
  const store = create_agent_storage(workspace, "archive-test").sessions;
  const archived_store = store.session("archived");
  await archived_store.messages.initialize();
  await archived_store.write_metadata({
    v: 1,
    session_id: "archived",
    agent_id: "archive-test",
    workspace_id: "test_workspace",
    updated_at: 1,
  });

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
