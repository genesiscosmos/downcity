/**
 * @file 验证 City 级 HTTP/RPC 在共享端口上按 Agent ID 隔离路由。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, RemoteAgent } from "../../agent/bin/index.js";
import { City, CityHTTP, CityRPC, MemoryCityStore } from "../bin/index.js";
import { create_agent_config, TestCityEnvironment } from "./TestCityEnvironment.mjs";

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
  const configs = [
    create_agent_config("first_agent", path.join(root, "first")),
    create_agent_config("second_agent", path.join(root, "second")),
  ];
  const city = new City(new MemoryCityStore(configs), new TestCityEnvironment());
  await city.ready();
  return { city, root };
}

test("CityHTTP mounts each Agent below its stable ID", async () => {
  const { city, root } = await create_city();
  const transport = new CityHTTP(city);
  try {
    const first_create = await transport.router().request(
      "/agents/first_agent/api/sdk/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "shared-session" }),
      },
    );
    assert.equal(first_create.status, 200);
    const first_list = await transport.router().request(
      "/agents/first_agent/api/sdk/sessions",
    );
    const second_list = await transport.router().request(
      "/agents/second_agent/api/sdk/sessions",
    );
    assert.deepEqual((await first_list.json()).sessions.map((item) => item.session_id), [
      "shared-session",
    ]);
    assert.deepEqual((await second_list.json()).sessions, []);
    assert.equal(
      (await transport.router().request("/agents/missing/api/sdk/sessions")).status,
      404,
    );
  } finally {
    await transport.close();
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityHTTP 动态识别运行中新增和删除的 Agent", async () => {
  const { city, root } = await create_city();
  const transport = new CityHTTP(city);
  try {
    transport.router();
    const config = create_agent_config("third_agent", path.join(root, "third"));
    const environment = new TestCityEnvironment();
    const agent = new Agent(await environment.create_agent_options(config));
    await city.add(agent);
    const created = await transport.router().request(
      "/agents/third_agent/api/sdk/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "dynamic-session" }),
      },
    );
    assert.equal(created.status, 200);
    await city.remove("third_agent");
    assert.equal(
      (await transport.router().request("/agents/third_agent/api/sdk/sessions")).status,
      404,
    );
  } finally {
    await transport.close();
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CityRPC routes RemoteAgent by rpc URL Agent ID", {
  skip: !network_tests_enabled,
}, async () => {
  const { city, root } = await create_city();
  const transport = new CityRPC(city);
  const port = await reserve_port();
  const first = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/first_agent` });
  const second = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/second_agent` });
  try {
    await transport.listen({ host: "127.0.0.1", port });
    await first.sessions.create({ session_id: "shared-session" });
    assert.deepEqual((await first.sessions.list()).items.map((item) => item.session_id), [
      "shared-session",
    ]);
    assert.deepEqual((await second.sessions.list()).items, []);
    const missing = new RemoteAgent({ url: `rpc://127.0.0.1:${port}/missing` });
    await assert.rejects(missing.sessions.list(), /Agent not found in City: missing/);
    await missing.close();
  } finally {
    await Promise.allSettled([first.close(), second.close(), transport.close()]);
    await city.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
