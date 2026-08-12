/**
 * LocalCityStore SQLite 恢复测试。
 *
 * 测试只验证配置关系和 City 恢复，不调用远程模型或 Plugin 生命周期。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { City, MemoryCityStore, Workspace, Agent } from "@downcity/agent";
import { get_local_database_path, LocalCityStore } from "../bin/index.js";

test("LocalCityStore 为旧 managed_agents 表补齐 Workspace 关系", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-legacy-schema-"));
  const database_path = get_local_database_path(root_path);
  const legacy_database = new DatabaseSync(database_path);
  legacy_database.exec(`
    CREATE TABLE managed_agents (
      agent_id TEXT PRIMARY KEY NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX managed_agents_updated_at_idx ON managed_agents(updated_at);
  `);
  legacy_database.close();

  const store = new LocalCityStore({ root_path });
  store.close();

  const migrated_database = new DatabaseSync(database_path);
  const columns = migrated_database.prepare("PRAGMA table_info(managed_agents)").all();
  const indexes = migrated_database.prepare("PRAGMA index_list(managed_agents)").all();
  assert.equal(columns.some((column) => column.name === "workspace_id"), true);
  assert.equal(indexes.some((index) => index.name === "managed_agents_workspace_id_idx"), true);
  migrated_database.close();
  await fs.rm(root_path, { recursive: true, force: true });
});

test("LocalCityStore 通过 City.add 持久化并恢复 Agent", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-"));
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-"));
  const store = new LocalCityStore({ root_path });
  const workspace = store.ensure_workspace({ workspace_path, name: "Test Workspace" });
  const agent = new Agent({
    id: "test_agent",
    workspace: new Workspace({ path: workspace_path }),
    definition: {
      version: "1.0.0",
      workspace_id: workspace.workspace_id,
      plugins: [],
    },
  });
  const city = new City(store);
  await city.ready();
  await city.add(agent);
  assert.equal(city.agent("test_agent"), agent);
  await city.dispose();

  const restored_store = new LocalCityStore({ root_path });
  const restored_city = new City(restored_store);
  await restored_city.ready();
  assert.equal(restored_city.agent("test_agent")?.id, "test_agent");
  assert.equal(restored_city.agent("test_agent")?.definition?.workspace_id, workspace.workspace_id);
  await restored_city.dispose();

  await fs.rm(root_path, { recursive: true, force: true });
  await fs.rm(workspace_path, { recursive: true, force: true });
});

test("City 仍可使用 MemoryCityStore 持有临时 Agent", async () => {
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-workspace-"));
  const agent = new Agent({
    id: "temporary_agent",
    workspace: new Workspace({ path: workspace_path }),
  });
  const city = new City(new MemoryCityStore([agent]));
  await city.ready();
  assert.equal(city.agent("temporary_agent"), agent);
  await city.dispose();
  await fs.rm(workspace_path, { recursive: true, force: true });
});

test("LocalCityStore 按固定优先级合并 env 并过滤平台身份变量", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-env-"));
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-env-"));
  await fs.writeFile(path.join(root_path, ".env"), [
    "GLOBAL_ONLY=global",
    "SHARED=global",
    "DOWNCITY_USER_TOKEN=must-not-leak",
  ].join("\n"));
  await fs.writeFile(path.join(workspace_path, ".env"), [
    "WORKSPACE_ONLY=workspace",
    "SHARED=workspace",
  ].join("\n"));
  const previous_shared = process.env.SHARED;
  process.env.SHARED = "process";
  try {
    const store = new LocalCityStore({ root_path });
    const workspace = store.ensure_workspace({ workspace_path });
    store.create_agent_config({ agent_id: "env_agent", execution: {} });
    store.bind_agent_workspace("env_agent", workspace.workspace_id);
    const env = store.reload_agent_env("env_agent");
    assert.equal(env.GLOBAL_ONLY, "global");
    assert.equal(env.WORKSPACE_ONLY, "workspace");
    assert.equal(env.SHARED, "process");
    assert.notEqual(env.DOWNCITY_USER_TOKEN, "must-not-leak");
    store.close();
  } finally {
    if (previous_shared === undefined) delete process.env.SHARED;
    else process.env.SHARED = previous_shared;
    await fs.rm(root_path, { recursive: true, force: true });
    await fs.rm(workspace_path, { recursive: true, force: true });
  }
});

test("LocalCityStore 只恢复宿主显式选择的 Agent", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-scope-"));
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-scope-"));
  const setup_store = new LocalCityStore({ root_path });
  const workspace = setup_store.ensure_workspace({ workspace_path });
  for (const agent_id of ["first_agent", "second_agent"]) {
    const agent = await setup_store.new_agent({
      agent_id,
      workspace_id: workspace.workspace_id,
      workspace_path,
      execution: {},
      plugins: [],
    });
    await setup_store.save_agent(agent);
    await agent.dispose();
  }
  setup_store.close();

  const city = new City(new LocalCityStore({ root_path, agent_ids: ["second_agent"] }));
  await city.ready();
  assert.deepEqual(city.agents().map((agent) => agent.id), ["second_agent"]);
  await city.dispose();
  await fs.rm(root_path, { recursive: true, force: true });
  await fs.rm(workspace_path, { recursive: true, force: true });
});

test("Plugin Resource 被 Binding 引用时拒绝删除", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-plugin-"));
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-plugin-"));
  const store = new LocalCityStore({ root_path });
  const workspace = store.ensure_workspace({ workspace_path });
  store.create_agent_config({ agent_id: "plugin_agent", execution: {} });
  store.bind_agent_workspace("plugin_agent", workspace.workspace_id);
  store.save_plugin_resource({
    plugin_name: "chat",
    item: { id: "telegram_main", type: "telegram", name: "Main", bot_token: "secret" },
  });
  store.save_agent_plugin_binding({
    agent_id: "plugin_agent",
    plugin_name: "chat",
    enabled: true,
    config: {},
    resource_ids: ["telegram_main"],
  });
  assert.throws(
    () => store.remove_plugin_resource("chat", "telegram_main"),
    /still bound to agent plugin_agent/u,
  );
  store.remove_agent_plugin_binding("plugin_agent", "chat");
  store.remove_plugin_resource("chat", "telegram_main");
  assert.equal(store.get_plugin_resource("chat", "telegram_main"), null);
  store.close();
  await fs.rm(root_path, { recursive: true, force: true });
  await fs.rm(workspace_path, { recursive: true, force: true });
});
