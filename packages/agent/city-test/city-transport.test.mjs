/**
 * @file 验证 City 级 HTTP/RPC 在共享端口上按 Agent ID 隔离路由。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, RemoteAgent } from "../bin/index.js";
import { Workspace } from "../../workspace/bin/index.js";
import { City } from "../bin/index.js";
import { CityHTTP } from "../bin/city/transport/http/CityHTTP.js";
import { CityRPC } from "../bin/city/transport/rpc/CityRPC.js";

const network_tests_enabled = process.env.DOWNCITY_RUN_NETWORK_TESTS === "1";

async function reserve_port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function create_city() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-transport-"));
  await Promise.all([
    fs.mkdir(path.join(root, "first")),
    fs.mkdir(path.join(root, "second")),
  ]);
  const first_workspace = new Workspace({
    id: "first",
    path: path.join(root, "first"),
    data_root_path: path.join(root, "data"),
  });
  const second_workspace = new Workspace({
    id: "second",
    path: path.join(root, "second"),
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [first_workspace, second_workspace] });
  const first_agent = new Agent({ id: "first_agent" });
  const second_agent = new Agent({ id: "second_agent" });
  city.agents.add(first_agent);
  city.agents.add(second_agent);
  const agents = [first_agent, second_agent];
  return { city, agents, root };
}

test("CityHTTP mounts each Agent below its stable ID", async () => {
  const { city, agents, root } = await create_city();
  const transport = new CityHTTP(city);
  try {
    const first_create = await transport.router().request(
      "/agents/first_agent/workspaces/first/api/sdk/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "shared-session" }),
      },
    );
    assert.equal(first_create.status, 200);
    const first_list = await transport.router().request(
      "/agents/first_agent/workspaces/first/api/sdk/sessions",
    );
    const second_list = await transport.router().request(
      "/agents/second_agent/workspaces/second/api/sdk/sessions",
    );
    assert.deepEqual((await first_list.json()).sessions.map((item) => item.session_id), [
      "shared-session",
    ]);
    assert.deepEqual((await second_list.json()).sessions, []);
    assert.equal(
      (await transport.router().request("/agents/missing/workspaces/first/api/sdk/sessions")).status,
      404,
    );
  } finally {
    await transport.close();
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityHTTP concurrently creates only one Agent extension", async () => {
  const { city, agents, root } = await create_city();
  let extension_count = 0;
  let dispose_count = 0;
  const transport = new CityHTTP(city, {
    create_agent_extension: ({ sdk_router }) => {
      extension_count += 1;
      return {
        router: sdk_router,
        dispose: () => {
          dispose_count += 1;
        },
      };
    },
  });
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      transport.router().request("/agents/first_agent/workspaces/first/api/sdk/sessions")
    ));
    assert.equal(responses.every((response) => response.status === 200), true);
    assert.equal(extension_count, 1);
  } finally {
    await transport.close();
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.equal(dispose_count, 1);
});

test("CityHTTP does not recreate an Agent removed while router resolution is queued", async () => {
  const { city, agents, root } = await create_city();
  let release_dispose;
  let extension_count = 0;
  const dispose_gate = new Promise((resolve) => {
    release_dispose = resolve;
  });
  const transport = new CityHTTP(city, {
    create_agent_extension: ({ sdk_router }) => {
      extension_count += 1;
      return { router: sdk_router, dispose: async () => await dispose_gate };
    },
  });
  try {
    assert.equal(
      (await transport.router().request("/agents/first_agent/workspaces/first/api/sdk/sessions")).status,
      200,
    );
    const detach_promise = transport.detach_agent("first_agent");
    const queued_request = transport.router().request("/agents/first_agent/workspaces/first/api/sdk/sessions");
    const remove_promise = (async () => {
      await city.agents.remove(agents[0].id);
      await detach_promise;
    })();
    release_dispose();
    await Promise.all([detach_promise, remove_promise]);
    assert.equal((await queued_request).status, 404);
    assert.equal(extension_count, 1);
  } finally {
    release_dispose();
    await transport.close();
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityHTTP retries an extension disposer after a failed close", async () => {
  const { city, agents, root } = await create_city();
  let dispose_count = 0;
  const transport = new CityHTTP(city, {
    create_agent_extension: ({ sdk_router }) => ({
      router: sdk_router,
      dispose: () => {
        dispose_count += 1;
        if (dispose_count === 1) throw new Error("dispose failed");
      },
    }),
  });
  try {
    assert.equal(
      (await transport.router().request("/agents/first_agent/workspaces/first/api/sdk/sessions")).status,
      200,
    );
    await assert.rejects(transport.close(), /CityHTTP extension close failed/);
    await transport.close();
    assert.equal(dispose_count, 2);
  } finally {
    await transport.close();
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityHTTP 动态识别运行中新增和删除的 Agent", async () => {
  const { city, agents, root } = await create_city();
  const transport = new CityHTTP(city);
  try {
    transport.router();
    await fs.mkdir(path.join(root, "third"));
    const agent = new Agent({
      id: "third_agent",
    });
    const workspace = new Workspace({
      id: "third",
      path: path.join(root, "third"),
      data_root_path: path.join(root, "data"),
    });
    city.agents.add(agent);
    city.workspaces.add(workspace);
    await agent.sessions.create({ workspace });
    const created = await transport.router().request(
      "/agents/third_agent/workspaces/third/api/sdk/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "dynamic-session" }),
      },
    );
    assert.equal(created.status, 200);
    await city.agents.remove(agent.id);
    await agent.dispose();
    assert.equal(
      (await transport.router().request("/agents/third_agent/workspaces/third/api/sdk/sessions")).status,
      404,
    );
  } finally {
    await transport.close();
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityRPC routes RemoteAgent by rpc URL Agent ID", {
  skip: !network_tests_enabled,
}, async () => {
  const { city, agents, root } = await create_city();
  const transport = new CityRPC(city);
  const port = await reserve_port();
  const first = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/first_agent/first` });
  const second = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/second_agent/second` });
  try {
    await transport.listen({ host: "127.0.0.1", port });
    await first.sessions.create({ session_id: "shared-session" });
    assert.deepEqual((await first.sessions.list()).items.map((item) => item.session_id), [
      "shared-session",
    ]);
    assert.deepEqual((await second.sessions.list()).items, []);
    const missing = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/missing/first` });
    await assert.rejects(missing.sessions.list(), /Agent not found in City: missing/);
    await missing.close();
  } finally {
    await Promise.allSettled([first.close(), second.close(), transport.close()]);
    await city.close();
    await Promise.all(agents.map((agent) => agent.dispose()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
