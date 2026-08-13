/** 验证 City 只管理已实例化 Agent 的内存索引与 transport。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../../agent/bin/index.js";
import { City } from "../bin/index.js";

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
  const city = new City();
  const first = await create_agent(root, "first");
  const duplicate = await create_agent(root, "first");
  try {
    city.add(first);
    assert.equal(city.require_agent("first"), first);
    assert.throws(() => city.add(duplicate), /already exists/u);
    assert.throws(() => city.require_agent("missing"), /not found/u);
  } finally {
    await duplicate.dispose();
    await city.close();
    await first.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City.close 不释放或清空 Agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-close-"));
  const city = new City();
  const agent = await create_agent(root, "owned");
  try {
    city.add(agent);
    await city.close();
    assert.equal(city.require_agent("owned"), agent);
    await city.close();
    await city.close();
    assert.equal(city.require_agent("owned"), agent);
  } finally {
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
