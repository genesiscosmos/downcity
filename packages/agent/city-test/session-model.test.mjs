/**
 * @file 验证 RemoteAgent 通过 RPC 控制 Session。
 *
 * 关键点（中文）
 * - RemoteAgent 只传递 model_id，模型实例由 Agent Server 宿主解析。
 * - compact 只验证 command 被远程 Session 接受，不应自行启动 turn。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, RemoteAgent } from "../bin/index.js";
import { create_agent_workspace } from "../bin/internal/index.js";
import { Workspace } from "../../workspace/bin/index.js";
import { AgentRPC } from "../bin/city/transport/rpc/AgentRPC.js";

const network_tests_enabled = process.env.DOWNCITY_RUN_NETWORK_TESTS === "1";

async function reserve_port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function send_rpc_request(port, request) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let buffered = "";
    socket.setTimeout(2_000);
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline_index = buffered.indexOf("\n");
      if (newline_index < 0) return;
      socket.destroy();
      resolve(JSON.parse(buffered.slice(0, newline_index)));
    });
    socket.once("timeout", () => reject(new Error("RPC request timed out")));
    socket.once("error", reject);
  });
}

test("RPC resolves model_id through the host and queues compact", {
  skip: !network_tests_enabled,
}, async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-server-session-model-"),
  );
  const model = {
    modelId: "host-model",
    provider: "test",
  };
  const agent = new Agent({
    id: "rpc_model_agent",
    model,
  });
  const entry = create_agent_workspace(agent, new Workspace({ id: "rpc_model_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));
  let resolved_model_id = "";
  const rpc = new AgentRPC(entry, {
    resolve_session_model: (model_id) => {
      resolved_model_id = model_id;
      return {
        modelId: model_id,
        provider: "test",
      };
    },
  });
  const port = await reserve_port();
  const remote_agent = new RemoteAgent({
    url: `rpc://127.0.0.1:${port}`,
  });
  try {
    await rpc.listen({ host: "127.0.0.1", port });
    const session = await remote_agent.sessions.create({
      session_id: "rpc-model-session",
    });
    const initial_info = await session.get_info();
    assert.equal("modelId" in initial_info, false);
    assert.equal(initial_info.model_label, "host-model");
    await session.set({ model_id: "selected-model" });
    assert.equal(resolved_model_id, "selected-model");
    assert.equal((await session.get_info()).model_label, "selected-model");
    await session.compact();
  } finally {
    await remote_agent.close();
    await rpc.close();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

test("RPC rejects remote model switching when the host has no resolver", {
  skip: !network_tests_enabled,
}, async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-server-model-resolver-required-"),
  );
  const agent = new Agent({
    id: "rpc_model_resolver_required_agent",
    model: { modelId: "host-model", provider: "test" },
  });
  const entry = create_agent_workspace(agent, new Workspace({ id: "resolver_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));
  const rpc = new AgentRPC(entry);
  const port = await reserve_port();
  const remote_agent = new RemoteAgent({ url: `rpc://127.0.0.1:${port}` });
  try {
    await rpc.listen({ host: "127.0.0.1", port });
    const session = await remote_agent.sessions.create({ session_id: "resolver-required" });
    await assert.rejects(
      session.set({ model_id: "selected-model" }),
      /model switching is not configured by the host/,
    );
  } finally {
    await remote_agent.close();
    await rpc.close();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

test("internal RPC 让宿主重新加载 Workspace Env", {
  skip: !network_tests_enabled,
}, async () => {
  const project_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-server-env-reload-"));
  const workspace = new Workspace({
    id: "env_workspace",
    path: project_root, data_root_path: path.join(project_root, "data"),
    env: { BEFORE: "value" },
  });
  const agent = new Agent({ id: "rpc_env_agent" });
  const entry = create_agent_workspace(agent, workspace);
  let reload_count = 0;
  const rpc = new AgentRPC(entry, {
    reload_workspace_env: () => {
      reload_count += 1;
      const env = { AFTER: "value" };
      workspace.set_env(env);
      return env;
    },
  });
  const port = await reserve_port();
  try {
    await rpc.listen({ host: "127.0.0.1", port });
    const frame = await send_rpc_request(port, {
      id: "reload-env",
      method: "internal.workspace.reload_env",
    });
    assert.equal(frame.success, true);
    assert.equal(frame.data.reloaded, true);
    assert.equal(frame.data.key_count, 1);
    assert.equal(reload_count, 1);
    assert.deepEqual(workspace.get_env(), { AFTER: "value" });
  } finally {
    await rpc.close();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});
