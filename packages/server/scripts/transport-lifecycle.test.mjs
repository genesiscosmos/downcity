/**
 * @file 验证 Agent HTTP/RPC transport 的协议错误与服务生命周期。
 *
 * 关键点（中文）
 * - HTTP 路由应将输入错误、领域错误映射为稳定 JSON 响应。
 * - transport 的 listen、binding 与 close 必须可重复调用且状态一致。
 */

import assert from "node:assert/strict"
import net from "node:net"
import test from "node:test"
import { AgentHTTP, AgentRPC } from "../bin/index.js"

const network_tests_enabled = process.env.DOWNCITY_RUN_NETWORK_TESTS === "1"

async function reserve_port() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return port
}

function create_transport_agent() {
  return {
    sessions: {
      async list() {
        throw new Error("session list failed")
      },
    },
    plugins: {
      async run_action({ plugin, action, payload }) {
        if (action === "throw") throw new Error("plugin failed")
        return { success: true, data: { plugin, action, payload } }
      },
    },
  }
}

test("AgentHTTP exposes stable validation and domain error responses", async () => {
  const http = new AgentHTTP(create_transport_agent())
  const router = http.router()
  assert.equal(http.router(), router)
  assert.equal(http.server(), http.server())

  const missing_plugin = await router.request("/api/plugins/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action_name: "run" }),
  })
  assert.equal(missing_plugin.status, 400)
  assert.deepEqual(await missing_plugin.json(), {
    success: false,
    error: "plugin_name is required",
  })

  const missing_action = await router.request("/api/plugins/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin_name: "test" }),
  })
  assert.equal(missing_action.status, 400)
  assert.equal((await missing_action.json()).error, "action_name is required")

  const plugin_failure = await router.request("/api/plugins/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin_name: "test", action_name: "throw" }),
  })
  assert.equal(plugin_failure.status, 500)
  assert.equal((await plugin_failure.json()).error, "plugin failed")

  const session_failure = await router.request("/api/sdk/sessions")
  assert.equal(session_failure.status, 500)
  assert.equal((await session_failure.json()).error, "session list failed")
  assert.equal((await router.request("/unknown")).status, 404)
})

test("AgentHTTP listen, binding and close remain idempotent", {
  skip: !network_tests_enabled,
}, async () => {
  const http = new AgentHTTP(create_transport_agent())
  const handle = http.server()
  assert.equal(handle.binding(), null)
  await assert.rejects(handle.listen({ port: 0 }), /valid TCP port/iu)

  const port = await reserve_port()
  const [first_binding, second_binding] = await Promise.all([
    handle.listen({ host: "127.0.0.1", port }),
    handle.listen({ host: "127.0.0.1", port }),
  ])
  assert.deepEqual(second_binding, first_binding)
  assert.deepEqual(handle.binding(), first_binding)
  assert.equal((await fetch(`${first_binding.url}/unknown`)).status, 404)

  await http.close()
  await http.close()
  assert.equal(handle.binding(), null)
  assert.notEqual(http.server(), handle)
})

test("AgentRPC listen, binding and close remain idempotent", {
  skip: !network_tests_enabled,
}, async () => {
  const rpc = new AgentRPC(create_transport_agent())
  const port = await reserve_port()
  assert.equal(rpc.binding(), null)
  try {
    const [first_binding, second_binding] = await Promise.all([
      rpc.listen({ host: "127.0.0.1", port }),
      rpc.listen({ host: "127.0.0.1", port }),
    ])
    assert.deepEqual(second_binding, first_binding)
    assert.deepEqual(rpc.binding(), first_binding)
  } finally {
    await rpc.close()
    await rpc.close()
  }
  assert.equal(rpc.binding(), null)
})
