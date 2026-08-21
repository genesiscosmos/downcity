/** 验证 City 只管理已实例化 Agent 的内存索引与 transport。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "../../agent/bin/index.js";
import { Workspace } from "../../workspace/bin/index.js";
import { City } from "../bin/index.js";

/** 创建临时运行时 Agent。 */
async function create_agent(root, agent_id) {
  const workspace_path = path.join(root, agent_id);
  await fs.mkdir(workspace_path, { recursive: true });
  return new Workspace({ id: agent_id, path: workspace_path, data_root_path: path.join(workspace_path, "data") });
}

test("Agent 绑定 City 后可使用 City Workspace 并拒绝重复 ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-add-"));
  const first_workspace = await create_agent(root, "first");
  const city = new City({ workspaces: [first_workspace] });
  const first = new Agent({ id: "first" });
  city.agents.add(first);
  try {
    assert.equal(city.agents.get("first"), first);
    assert.throws(() => city.agents.add(new Agent({ id: "first" })), /already exists/u);
    assert.equal(city.agents.get("missing"), null);
  } finally {
    await city.close();
    await first.dispose();
    await first_workspace.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City 运行时添加 Workspace 后 Agent 可以进入", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-workspace-add-"));
  const workspace_path = path.join(root, "runtime");
  await fs.mkdir(workspace_path, { recursive: true });
  const city = new City();
  const agent = new Agent({ id: "runtime-agent" });
  city.agents.add(agent);
  const workspace = new Workspace({
    id: "runtime-workspace",
    path: workspace_path,
    data_root_path: path.join(root, "data"),
  });
  try {
    assert.equal(city.workspaces.add(workspace), workspace);
    assert.equal(city.workspaces.get(workspace.id), workspace);
    assert.deepEqual(city.workspaces.list(), [workspace]);
    assert.equal(agent.enter(workspace).workspace, workspace);
  } finally {
    await city.close();
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City.close 释放绑定 Agent 与 City Workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-close-"));
  const workspace = await create_agent(root, "owned");
  const city = new City({ workspaces: [workspace] });
  const agent = new Agent({ id: "owned" });
  city.agents.add(agent);
  try {
    await city.close();
    assert.equal(city.agents.get("owned"), null);
    await city.close();
    await city.close();
    assert.equal(city.agents.get("owned"), null);
  } finally {
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agent dispose 解除 City 运行时绑定", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-remove-"));
  const workspace = await create_agent(root, "retry_remove");
  const city = new City({ workspaces: [workspace] });
  const agent = new Agent({ id: "retry_remove" });
  city.agents.add(agent);
  try {
    assert.equal(city.agents.get(agent.id), agent);
    await agent.dispose();
    assert.equal(city.agents.get(agent.id), null);
  } finally {
    await city.close();
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
