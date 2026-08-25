/**
 * @file 验证 SessionStore / SessionDataStore 的领域边界与本地实现契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../bin/index.js";
import { create_workspace_entry } from "../bin/internal/index.js";
import { Workspace } from "@downcity/workspace";
import { LocalStorageProvider } from "@downcity/workspace";
import { LocalSessionStore } from "../bin/workspace/store/LocalSessionStore.js";

/** 由 Agent 领域在 City 提供的 Agent 作用域上创建 SessionStore。 */
function create_agent_storage(storage, agent_id, workspace_id = "test_workspace") {
  const scope = storage.open_scope([
    "agents",
    agent_id,
  ]);
  return {
    root_path: scope.root_path,
    files: scope.files,
    sessions: new LocalSessionStore({
      files: scope.files,
      storage_root_path: scope.root_path,
      agent_id,
      workspace_id,
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

test("Agent creates SessionStore on the Agent storage scope", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
  });
  const storage = create_agent_storage(new LocalStorageProvider(data_root_path), "store-test");
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
  });
  const store = create_agent_storage(new LocalStorageProvider(data_root_path), "archive-test").sessions;
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

test("LocalSessionStore 按 Workspace 隔离活动与归档 Session", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const store = create_agent_storage(new LocalStorageProvider(data_root_path), "workspace-filter-test", null).sessions;

  for (const [session_id, workspace_id] of [["first", "workspace-first"], ["second", "workspace-second"]]) {
    const session_store = store.session(session_id, workspace_id);
    await session_store.messages.initialize();
    await session_store.write_metadata({
      v: 1,
      session_id,
      agent_id: "workspace-filter-test",
      workspace_id,
      updated_at: 1,
    });
  }

  assert.deepEqual(
    (await store.list_sessions({ workspace_id: "workspace-first" }, new Set())).items.map((item) => item.session_id),
    ["first"],
  );
  assert.deepEqual(
    (await store.list_sessions({ workspace_id: "workspace-missing" }, new Set())).items,
    [],
  );

  await store.archive_session("first");
  assert.deepEqual(
    (await store.list_archived_sessions({ workspace_id: "workspace-first" })).items.map((item) => item.session_id),
    ["first"],
  );
  assert.deepEqual(
    (await store.list_archived_sessions({ workspace_id: "workspace-second" })).items,
    [],
  );
});

test("Workspace execution entry obtains its Store from the Agent storage scope", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "test_workspace",
    path: workspace_path,
    data_root_path,
  });
  const agent = new Agent({ id: "dispose-test" });
  const entry = create_workspace_entry(agent, workspace);

  assert.equal(entry.workspace, workspace);
  const first_session = await entry.sessions.create();
  assert.ok(first_session.id);
  await agent.dispose();
});

test("Agent sessions runtime 只解析已加载的 Session", async () => {
  const agent = new Agent({ id: "runtime-lookup-test" });
  try {
    assert.throws(
      () => agent.sessions.runtime("missing-session"),
      /call sessions\.get\(session_id\) first/u,
    );
    const session = await agent.sessions.create();
    assert.equal(agent.sessions.runtime(session.id).session_id, session.id);
  } finally {
    await agent.dispose();
  }
});
