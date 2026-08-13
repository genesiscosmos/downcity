/** 验证 City 对已实例化 Agent 与 transport 生命周期的所有权。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../../agent/bin/index.js";
import { City, MemoryCityStore } from "../bin/index.js";

/** 创建临时运行时 Agent。 */
async function create_agent(root, agent_id) {
  const workspace_path = path.join(root, agent_id);
  await fs.mkdir(workspace_path, { recursive: true });
  return new Agent({
    id: agent_id,
    workspace: new Workspace({ path: workspace_path }),
  });
}

test("City.add 注册调用方创建的 Agent 并拒绝重复 ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-add-"));
  const city = new City(new MemoryCityStore());
  const first = await create_agent(root, "first");
  const duplicate = await create_agent(root, "first");
  try {
    await city.add(first);
    assert.equal(city.require_agent("first"), first);
    await assert.rejects(city.add(duplicate), /already exists/u);
    assert.throws(() => city.require_agent("missing"), /not found/u);
  } finally {
    await duplicate.dispose();
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City.close 不释放 Agent，City.dispose 完成最终释放", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-close-"));
  const city = new City(new MemoryCityStore());
  const agent = await create_agent(root, "owned");
  try {
    await city.add(agent);
    await city.close();
    assert.equal(city.require_agent("owned"), agent);
    await city.dispose();
    await city.dispose();
    assert.throws(() => city.agents(), /disposed/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
