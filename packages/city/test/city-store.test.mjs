/**
 * CityStore 契约测试。
 *
 * 覆盖配置装配、实例管理和失败收口，不允许 Store 创建或接收 Agent。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { City } from "../bin/index.js";
import { create_agent_config, TestCityEnvironment } from "./TestCityEnvironment.mjs";

/** 创建可观察调用的纯数据 Store。 */
function create_store(configs = []) {
  let load_count = 0;
  let disposed = false;
  return {
    get load_count() {
      return load_count;
    },
    get disposed() {
      return disposed;
    },
    async load_agent_configs() {
      load_count += 1;
      return structuredClone(configs);
    },
    async dispose() {
      disposed = true;
    },
  };
}

test("City 从 Store 配置装配并持有可直接使用的 Agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-store-"));
  const config = create_agent_config("lucas", path.join(root, "lucas"));
  const store = create_store([config]);
  const environment = new TestCityEnvironment();
  const city = new City(store, environment);
  try {
    assert.throws(() => city.agents(), /initialization has not completed/u);
    await city.ready();
    assert.deepEqual(environment.created_agent_ids, ["lucas"]);
    assert.equal(city.agent("lucas")?.id, "lucas");
    assert.equal(city.agent("missing"), null);
    assert.equal(
      city.require_agent("lucas").workspace.path,
      await fs.realpath(path.join(root, "lucas")),
    );
    assert.equal(store.load_count, 1);
  } finally {
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.equal(store.disposed, true);
  assert.equal(environment.disposed, true);
});

test("City.remove 只移除并释放目标实例，不再次访问 Store", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-remove-"));
  const configs = ["first", "second"].map((id) =>
    create_agent_config(id, path.join(root, id))
  );
  const store = create_store(configs);
  const city = new City(store, new TestCityEnvironment());
  try {
    await city.ready();
    const first = city.require_agent("first");
    assert.equal(await city.remove("first"), first);
    assert.equal(store.load_count, 1);
    assert.deepEqual(city.agents().map((agent) => agent.id), ["second"]);
  } finally {
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Store 返回重复 ID 配置时释放已装配实例并整体失败", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-duplicate-"));
  const configs = [
    create_agent_config("duplicate", path.join(root, "first")),
    create_agent_config("duplicate", path.join(root, "second")),
  ];
  const city = new City(create_store(configs), new TestCityEnvironment());
  await assert.rejects(city.ready(), /duplicate Agent/u);
  await city.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

test("Agent 构造失败时 City 释放 Environment 创建的 Workspace", async () => {
  let workspace_disposed = false;
  const config = create_agent_config("broken", "/virtual/broken");
  const city = new City(create_store([config]), {
    async create_agent_options() {
      return {
        id: "broken",
        workspace: {
          path: "/virtual/broken",
          files: {},
          tools: { duplicate: {} },
          get_env: () => ({}),
          set_env: () => undefined,
          patch_env: () => undefined,
          subscribe_env: () => () => undefined,
          create_session_store: () => {
            throw new Error("should not bind invalid Agent");
          },
          async dispose() {
            workspace_disposed = true;
          },
        },
        tools: { duplicate: {} },
      };
    },
  });
  await assert.rejects(city.ready(), /tool name conflict/u);
  assert.equal(workspace_disposed, true);
  await city.dispose();
});
