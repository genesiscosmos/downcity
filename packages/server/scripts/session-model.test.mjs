/**
 * @file 验证 RemoteAgent 通过 RPC 控制 Session。
 *
 * 关键点（中文）
 * - RemoteAgent 不暴露模型选择协议，模型实例由 Agent 在本地持有。
 * - compact 只验证 command 被远程 Session 接受，不应自行启动 turn。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, RemoteAgent, Workspace } from "../../agent/bin/index.js";
import { AgentRPC } from "../bin/index.js";

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

test("RPC uses the Agent runtime model and queues compact", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-server-session-model-"),
  );
  const model = {
    modelId: "host-model",
    provider: "test",
  };
  const agent = new Agent({
    id: "rpc_model_agent",
    workspace: new Workspace({ path: project_root }),
    model,
  });
  const rpc = new AgentRPC(agent);
  const port = await reserve_port();
  const remote_agent = new RemoteAgent({
    url: `rpc://127.0.0.1:${port}`,
  });
  try {
    await agent.ready();
    await rpc.listen({ host: "127.0.0.1", port });
    const session = await remote_agent.sessions.create({
      session_id: "rpc-model-session",
    });
    assert.equal("modelId" in (await session.get_info()), false);
    await session.compact();
  } finally {
    await remote_agent.close();
    await rpc.close();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});
