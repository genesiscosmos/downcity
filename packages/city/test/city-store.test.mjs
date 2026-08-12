/**
 * CityStore 契约测试。
 *
 * 覆盖 City 恢复、注册、删除和释放的所有权语义，不依赖具体数据库实现。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { City } from "../bin/index.js";

function create_agent(id, disposed_ids) {
  return {
    id,
    async dispose() {
      disposed_ids.push(id);
    },
  };
}

function create_store(restored_agents = []) {
  const saved_ids = [];
  const removed_ids = [];
  let disposed = false;
  return {
    saved_ids,
    removed_ids,
    get disposed() {
      return disposed;
    },
    async load_agents() {
      return restored_agents;
    },
    async save_agent(agent) {
      saved_ids.push(agent.id);
    },
    async remove_agent(agent_id) {
      removed_ids.push(agent_id);
    },
    async dispose() {
      disposed = true;
    },
  };
}

test("City 恢复后返回可直接使用的 Agent 实例", async () => {
  const disposed_ids = [];
  const lucas = create_agent("lucas", disposed_ids);
  const store = create_store([lucas]);
  const city = new City(store);

  assert.throws(() => city.agents(), /City\.ready/);
  await city.ready();

  assert.deepEqual(city.agents(), [lucas]);
  assert.equal(city.agent("lucas"), lucas);
  assert.equal(city.agent("missing"), null);
  assert.equal(city.require_agent("lucas"), lucas);

  await city.dispose();
  assert.deepEqual(disposed_ids, ["lucas"]);
  assert.equal(store.disposed, true);
});

test("City.add 先持久化，成功后才注册实例", async () => {
  const disposed_ids = [];
  const store = create_store();
  const city = new City(store);
  await city.ready();

  const agent = create_agent("new_agent", disposed_ids);
  await city.add(agent);

  assert.deepEqual(store.saved_ids, ["new_agent"]);
  assert.equal(city.agent("new_agent"), agent);
  await city.dispose();
});

test("City.remove 删除注册后释放 Agent，但不释放其他实例", async () => {
  const disposed_ids = [];
  const first = create_agent("first", disposed_ids);
  const second = create_agent("second", disposed_ids);
  const store = create_store([first, second]);
  const city = new City(store);
  await city.ready();

  assert.equal(await city.remove("first"), first);
  assert.deepEqual(store.removed_ids, ["first"]);
  assert.deepEqual(disposed_ids, ["first"]);
  assert.deepEqual(city.agents(), [second]);

  await city.dispose();
  assert.deepEqual(disposed_ids, ["first", "second"]);
});

test("Store 恢复重复 ID 时释放全部临时实例并整体失败", async () => {
  const disposed_ids = [];
  const store = create_store([
    create_agent("duplicate", disposed_ids),
    create_agent("duplicate", disposed_ids),
  ]);
  const city = new City(store);

  await assert.rejects(city.ready(), /duplicate Agent/);
  assert.deepEqual(disposed_ids, ["duplicate", "duplicate"]);
  await city.dispose();
});
