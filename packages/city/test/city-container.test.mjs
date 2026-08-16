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
  const agent = new Agent({ id: agent_id });
  agent.enter(new Workspace({ id: agent_id, path: workspace_path }));
  return agent;
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

test("City.remove 在 transport 释放失败时恢复 Agent 可见性并允许重试", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-remove-"));
  const city = new City();
  const agent = await create_agent(root, "retry_remove");
  let detach_count = 0;
  city.http.detach_agent = async () => {
    detach_count += 1;
    if (detach_count === 1) throw new Error("detach failed");
  };
  try {
    city.add(agent);
    await assert.rejects(city.remove(agent.id), /detach failed/u);
    assert.equal(city.require_agent(agent.id), agent);
    assert.equal(await city.remove(agent.id), agent);
    assert.equal(city.agent(agent.id), null);
    assert.equal(detach_count, 2);
  } finally {
    await city.close();
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City.listen 失败只回滚本次新启动的 transport", async () => {
  const city = new City();
  let rpc_listen_count = 0;
  let rpc_close_count = 0;
  let rpc_binding = null;
  city.rpc.listen = async () => {
    rpc_listen_count += 1;
    rpc_binding ??= { url: "rpc://127.0.0.1:15314", host: "127.0.0.1", port: 15314 };
    return rpc_binding;
  };
  city.rpc.binding = () => rpc_binding;
  city.rpc.close = async () => {
    rpc_close_count += 1;
    rpc_binding = null;
  };
  city.http.listen = async () => {
    throw new Error("http unavailable");
  };
  city.http.binding = () => null;

  await city.listen({ rpc: { port: 15314 } });
  await assert.rejects(
    city.listen({ rpc: { port: 15314 }, http: { port: 5314 } }),
    /http unavailable/u,
  );
  assert.equal(rpc_listen_count, 2);
  assert.equal(rpc_close_count, 0);
  assert.notEqual(rpc_binding, null);

  await city.close();
  assert.equal(rpc_close_count, 1);
});
