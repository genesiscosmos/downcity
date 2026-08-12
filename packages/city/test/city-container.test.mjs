/** 验证 City 对进程内 Agent 实例的所有权与生命周期。 */

import assert from "node:assert/strict";
import test from "node:test";
import { City, MemoryCityStore } from "../bin/index.js";

/** 创建可观察释放行为的最小 Agent 替身。 */
function create_agent(agent_id, dispose_calls) {
  return {
    id: agent_id,
    async dispose() {
      dispose_calls.push(agent_id);
    },
  };
}

test("City 管理 Agent 集合并拒绝重复 ID", async () => {
  const dispose_calls = [];
  const first = create_agent("first", dispose_calls);
  const city = new City(new MemoryCityStore([first]));
  await city.ready();

  assert.equal(city.agent("first"), first);
  assert.equal(city.require_agent("first"), first);
  assert.deepEqual(city.agents(), [first]);
  await assert.rejects(
    city.add(create_agent("first", dispose_calls)),
    /already exists/u,
  );
  assert.throws(() => city.require_agent("missing"), /not found/u);
  await city.dispose();
});

test("City remove 和 dispose 只释放仍由容器拥有的 Agent", async () => {
  const dispose_calls = [];
  const first = create_agent("first", dispose_calls);
  const second = create_agent("second", dispose_calls);
  const city = new City(new MemoryCityStore([first, second]));
  await city.ready();

  assert.equal(await city.remove("first"), first);
  assert.deepEqual(dispose_calls, ["first"]);
  await city.dispose();
  await city.dispose();

  assert.deepEqual(dispose_calls, ["first", "second"]);
  assert.throws(() => city.agents(), /disposed/u);
  await assert.rejects(
    city.add(create_agent("third", dispose_calls)),
    /disposed/u,
  );
});
