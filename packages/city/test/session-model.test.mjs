/**
 * @file 验证 RemoteAgent 通过 RPC 控制 Session。
 *
 * 关键点（中文）
 * - Session 继承所属 Agent 模型，远程配置只接受安全策略。
 * - 独立 Session 模型参数在解析边界拒绝，不创建模型覆盖。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@downcity/agent";
import { RemoteAgent, Workspace } from "@downcity/city";
import { resolve_remote_session_set_input } from "../bin/city/transport/session/RemoteSessionConfig.js";
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

test("Session 继承 Agent 当前模型，Agent 改模不需要 Session 配置", async () => {
  const first_model = { id: "first-model", stream: async () => new ReadableStream() };
  const next_model = { id: "next-model", stream: async () => new ReadableStream() };
  const agent = new Agent({ id: "model-agent", model: first_model });
  try {
    const session = await agent.sessions.create({ type: "chat", kind: "test" });
    assert.equal(session.get("model"), first_model);
    agent.reconfigure({ model: next_model });
    assert.equal(session.get("model"), next_model);
    assert.equal((await session.get_info()).model_label, "next-model");
    await assert.rejects(session.set({ model: first_model }), /configure the Agent model/);
  } finally { await agent.dispose(); }
});

test("远程 Session 配置只接受安全策略并拒绝独立模型参数", async () => {
  assert.deepEqual(await resolve_remote_session_set_input({ config: { security: { approval_mode: "ask" } } }), { security: { approval_mode: "ask" } });
  await assert.rejects(resolve_remote_session_set_input({ config: { model: { downtown: "source", id: "model" } } }), /configure the Agent model/);
  await assert.rejects(resolve_remote_session_set_input({ config: {} }), /requires security/);
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
  let reload_count = 0;
  const rpc = new AgentRPC(agent, workspace, {
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
