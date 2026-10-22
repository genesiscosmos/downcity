/**
 * @file 验证 SessionStore / SessionStorage 的领域边界与本地实现契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { Workspace, LocalStorageProvider } from "@downcity/city";
import { LocalSessionStore } from "../../agent/bin/session/storage/LocalSessionStore.js";

/** 由 Agent 领域在 City 提供的 Agent 作用域上创建 SessionStore。 */
function create_agent_storage(storage, agent_id, workspace_id = "test_workspace") {
  const scope = storage.open_scope([
    "agents",
    agent_id,
  ]);
  return {
    root_path: scope.root_path,
    files: scope.files,
    database_location: scope.database_location,
    sessions: new LocalSessionStore({
      files: scope.files,
      storage_root_path: scope.root_path,
      agent_id,
      workspace_id,
      database_location: scope.database_location,
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
  const session_store = store.create_session("first", { type: "work" });

  assert.equal(store.create_session("first", { type: "work" }), session_store);
  assert.equal(await store.has_session("first"), false);

  await session_store.initialize();
  await session_store.write_metadata({
    v: 2,
    session_id: "first",
    agent_id: "store-test",
    workspace_id: "test_workspace",
    origin: { category: "work", type: "work" },
    created_at: 1,
    updated_at: 1,
    title: "独立存储",
  });
  await session_store.write_instruction("独立存储系统提示");

  assert.equal(await store.has_session("first"), true);
  assert.equal((await session_store.read_metadata()).title, "独立存储");
  assert.equal(await session_store.has_instruction(), true);
  assert.equal(await session_store.read_instruction(), "独立存储系统提示");
  assert.equal(
    await fs.access(path.join(storage.root_path, "sessions", "work", "first", "session.db"))
      .then(() => true)
      .catch(() => false),
    true,
  );
  assert.equal(await fs.access(path.join(workspace_path, ".downcity")).then(() => true).catch(() => false), false);
  assert.equal((await fs.stat(storage.root_path)).mode & 0o777, 0o700);
  assert.ok((await fs.stat(path.join(storage.root_path, "sessions", "work", "first", "session.db"))).size > 0);

  assert.equal(await store.clear_session_messages("first"), true);
  assert.equal((await (await store.open_session("first", "work")).read_metadata()).title, "独立存储");
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
  const archived_store = store.create_session("archived", { type: "work" });
  await archived_store.initialize();
  await archived_store.write_metadata({
    v: 2,
    session_id: "archived",
    agent_id: "archive-test",
    workspace_id: "test_workspace",
    origin: { category: "work", type: "work" },
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
    const session_store = store.create_session(session_id, { type: "work" }, workspace_id);
    await session_store.initialize();
    await session_store.write_metadata({
      v: 2,
      session_id,
      agent_id: "workspace-filter-test",
      workspace_id,
      origin: { category: "work", type: "work" },
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

test("Agent Session 按开放 origin 类型确定性分区", async (t) => {
  const { data_root_path, workspace_path } = await create_test_roots(t);
  const workspace = new Workspace({
    id: "origin_workspace",
    path: workspace_path,
  });
  const storage = new LocalStorageProvider(data_root_path);
  const agent = new Agent({ id: "origin-agent" });
  const scope = storage.open_scope(["agents", agent.id]);
  const store = new LocalSessionStore({
    files: scope.files,
    storage_root_path: scope.root_path,
    agent_id: agent.id,
    database_location: scope.database_location,
  });
  const chat_session = store.create_session("shared-session", { category: "chat", type: "agent" }, workspace.id);
  const task_origin = {
    category: "work",
    type: "task",
    task_id: "daily-report",
    execution_id: "execution-1",
  };
  const task_session = store.create_session("shared-session", task_origin, workspace.id);
  const automation_session = store.create_session(
    "automation-session",
    { category: "work", type: "automation/daily", schedule_id: "daily-report" },
    workspace.id,
  );

  await chat_session.write_metadata(await chat_session.read_metadata());
  await task_session.write_metadata(await task_session.read_metadata());
  await automation_session.write_metadata(await automation_session.read_metadata());

  // 分类承担物理分区：同一个 session_id 可以分别存在于 chat 与 work，两者互不覆盖。
  assert.equal(await store.has_session("shared-session", "chat"), true);
  assert.equal(await store.has_session("shared-session", "work"), true);
  assert.equal(await store.has_session("automation-session", "work"), true);
  assert.deepEqual((await task_session.read_metadata()).origin, task_origin);
  await task_session.write_metadata({
    ...(await task_session.read_metadata()),
    origin: { ...task_origin, execution_id: "execution-2" },
  });
  assert.deepEqual((await task_session.read_metadata()).origin, task_origin);
  const restored_store = new LocalSessionStore({
    files: scope.files,
    storage_root_path: scope.root_path,
    agent_id: agent.id,
    database_location: scope.database_location,
  });
  const restored_task_session = await restored_store.open_session("shared-session", "work");
  const restored_metadata = await restored_task_session.read_metadata();
  assert.deepEqual(restored_task_session.origin, task_origin);
  await restored_task_session.write_metadata(restored_metadata);
  assert.deepEqual(
    (await store.list_sessions(undefined, new Set())).items.map((item) => item.session_id).sort(),
    ["automation-session", "shared-session"],
  );
  // 分类内按角色过滤：只返回 role 为 task 的那一条。
  assert.deepEqual(
    (await store.list_sessions({ category: "work", origin_type: "task" }, new Set())).items.map((item) => item.session_id),
    ["shared-session"],
  );
  // 同一 session_id 在 chat 与 work 两个分类下各有一条，按分类分区存放。
  assert.equal(
    await fs.access(path.join(scope.root_path, "sessions", "work", "shared-session", "session.db"))
      .then(() => true)
      .catch(() => false),
    true,
  );
  assert.equal(
    await fs.access(path.join(scope.root_path, "sessions", "chat", "shared-session", "session.db"))
      .then(() => true)
      .catch(() => false),
    true,
  );
  // 自定义角色不需要单独目录，它就在分类目录下。
  assert.equal(
    await fs.access(path.join(scope.root_path, "sessions", "work", "automation-session", "session.db"))
      .then(() => true)
      .catch(() => false),
    true,
  );
  await agent.dispose();
});
