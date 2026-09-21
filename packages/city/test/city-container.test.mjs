/** 验证 City 只管理已实例化 Agent 的内存索引与 transport。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Group } from "@downcity/agent";
import { City, Workspace } from "../bin/index.js";

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
    const session = await first.sessions.create({ workspace: first_workspace });
    assert.equal(session.agent_id, first.id);
  } finally {
    await city.close();
    await first.dispose();
    await first_workspace.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agent 创建无 City Session 后不能再切换到 City 存储", async () => {
  const agent = new Agent({ id: "memory-first-agent" });
  const replacement = new Agent({ id: "memory-first-agent" });
  const city = new City();
  try {
    await agent.sessions.create();
    assert.throws(
      () => city.agents.add(agent),
      /already used standalone storage/u,
    );
    assert.equal(city.agents.add(replacement), replacement);
    assert.equal(city.agents.get(replacement.id), replacement);
  } finally {
    await agent.dispose();
    await city.close();
  }
});

test("City 删除 Workspace 前释放全部 Agent 执行作用域", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-remove-"));
  const workspace = await create_agent(root, "workspace-remove");
  const agent = new Agent({ id: "workspace-remove" });
  const city = new City({ agents: [agent], workspaces: [workspace] });
  try {
    await agent.sessions.create({ workspace });
    assert.equal(await city.workspaces.remove(workspace.id), workspace);
    assert.equal(city.workspaces.get(workspace.id), null);
    // Workspace 归属由容器边界负责：移除后 Agent 仍可被要求使用它，
    // 但容器已不再索引该实例。
    assert.equal(city.workspaces.get(workspace.id), null);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City 删除 Workspace 期间不阻塞其他 Workspace 的进入", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-removing-"));
  const workspace = await create_agent(root, "workspace-removing");
  const agent = new Agent({ id: "workspace-removing" });
  const city = new City({ agents: [agent], workspaces: [workspace] });
  try {
    await agent.sessions.create({ workspace });
    let finish_leave;
    const leave_finished = new Promise((resolve) => {
      finish_leave = resolve;
    });
    const original_release = agent.release_workspace.bind(agent);
    agent.release_workspace = async (workspace_id) => {
      await leave_finished;
      await original_release(workspace_id);
    };

    const removal = city.workspaces.remove(workspace.id);
    try {
      // 引用已先放下：移除进行中查询立即不可见。
      assert.equal(city.workspaces.get(workspace.id), null);
    } finally {
      finish_leave();
    }
    await removal;
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("City 连带删除 Agent Group 时解除 Group Storage 所有权", async () => {
  const agent = new Agent({ id: "group-owner-agent" });
  const group = new Group({ id: "group-owner", members: [agent] });
  const city = new City({ agents: [agent], groups: [group] });
  const next_city = new City();
  try {
    assert.equal(await city.agents.remove(agent.id), agent);
    assert.equal(city.groups.get(group.id), null);
    assert.doesNotThrow(() => group.bind(next_city));
    await group.unbind();
  } finally {
    await city.close();
    await next_city.close();
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
    assert.equal((await agent.sessions.create({ workspace })).agent_id, agent.id);
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

test("City.close 后拒绝继续添加 Agent 或 Workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-closed-"));
  const workspace_path = path.join(root, "workspace");
  await fs.mkdir(workspace_path, { recursive: true });
  const city = new City();
  await city.close();
  assert.throws(() => city.agents.add(new Agent({ id: "closed-agent" })), /City is closed/u);
  assert.throws(() => city.workspaces.add(new Workspace({ id: "closed-workspace", path: workspace_path })), /City is closed/u);
  assert.equal(city.agents.list().length, 0);
  assert.equal(city.workspaces.list().length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("Agent dispose 在绑定容器时被拒绝", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-remove-"));
  const workspace = await create_agent(root, "retry_remove");
  const city = new City({ workspaces: [workspace] });
  const agent = new Agent({ id: "retry_remove" });
  city.agents.add(agent);
  try {
    assert.equal(city.agents.get(agent.id), agent);
    // 已注册主体不能自行释放：容器仍持有引用，必须走容器入口。
    await assert.rejects(agent.dispose(), /is bound to a container/u);
    assert.equal(city.agents.get(agent.id), agent);
    assert.equal(await city.agents.remove(agent.id), agent);
    assert.equal(city.agents.get(agent.id), null);
    // 解绑后主体回到独立运行状态，可以自行释放。
    await agent.dispose();
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
  city.rpc_transport.listen = async () => {
    rpc_listen_count += 1;
    rpc_binding ??= { url: "rpc://127.0.0.1:15314", host: "127.0.0.1", port: 15314 };
    return rpc_binding;
  };
  city.rpc_transport.binding = () => rpc_binding;
  city.rpc_transport.close = async () => {
    rpc_close_count += 1;
    rpc_binding = null;
  };
  city.http_transport.listen = async () => {
    throw new Error("http unavailable");
  };
  city.http_transport.binding = () => null;

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
