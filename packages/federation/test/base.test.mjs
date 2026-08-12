import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { MockLanguageModelV3 } from "ai/test"

import {
  Federation,
  AIService,
  AIChannel,
  InstallableService,
} from "../bin/legacy.js"
import { TableApi } from "../bin/store/table-api.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session, create_test_federation } from "./admin-fixture.mjs"

function useMemoryQueue(base) {
  const messages = []
  base.queue.use({
    async send(message) {
      messages.push(message)
    },
  })
  return messages
}

/** 创建 AIChannel 语言模型测试使用的固定文本流。 */
function create_text_stream(text = "ok") {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: "text_1" })
        controller.enqueue({ type: "text-delta", id: "text_1", delta: text })
        controller.enqueue({ type: "text-end", id: "text_1" })
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        })
        controller.close()
      },
    }),
  }
}

test("TableApi reads postgres-js RowList count for compare-and-set updates", async () => {
  const rows = []
  Object.defineProperty(rows, "count", { value: 1 })
  const schema = sqliteTable("cas_rows", {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
  })
  const db = {
    update() {
      return {
        set() {
          return { where: async () => rows }
        },
      }
    },
  }
  const table = new TableApi(db, schema)

  const changed = await table.update({
    where: { id: "row_1", status: "pending" },
    values: { status: "processing" },
  })
  assert.equal(changed, 1)
})

test("InstallableService always installs routes before custom initialization", async () => {
  const lifecycle_events = []

  class LifecycleService extends InstallableService {
    id = "lifecycle"
    name = "Lifecycle"

    install(ctx) {
      lifecycle_events.push("install")
      ctx.route({
        method: "GET",
        path: "/ping",
        public: true,
        handler: () => Response.json({ initialized: true }),
      })
    }

    async on_init() {
      lifecycle_events.push("on_init")
    }
  }

  const db = createSqliteDb(":memory:")
  const federation = create_test_federation({ database: db })
  federation.use(new LifecycleService())

  await federation.health()

  assert.deepEqual(lifecycle_events, ["install", "on_init"])
  const response = await federation.fetch(new Request("http://localhost/v1/lifecycle/ping"))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { initialized: true })
})

test("Federation instruction aggregates built-in and service documentation", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-instruction-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)

    base.use({
      id: "demo",
      name: "Demo InstallableService",
      instruction: "这是一个测试服务说明。",
      install(ctx) {
        ctx.route({
          method: "GET",
          path: "/ping",
          auth: ["admin"],
          handler() {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          },
        })
      },
    })

    const text = await base.instruction()

    assert.match(text, /# Downcity Federation Instruction/)
    assert.match(text, /## Env \(env\)/)
    assert.match(text, /## Bureaus \(bureaus\)/)
    assert.match(text, /## Demo InstallableService \(demo\)/)
    assert.match(text, /这是一个测试服务说明。/)
    assert.match(text, /GET \/v1\/demo\/ping \| auth: admin/)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation instruction endpoint requires admin auth and returns text", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-instruction-http-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    await base.health()
    const adminSession = await create_test_admin_session(base)

    const guestResponse = await base.fetch(new Request("http://localhost/v1/federation/instruction", {
      method: "GET",
    }))
    assert.equal(guestResponse.status, 401)
    assert.deepEqual(await guestResponse.json(), {
      error: {
        message: "Authentication required",
        type: "server_error",
      },
    })

    const adminResponse = await base.fetch(new Request("http://localhost/v1/federation/instruction", {
      method: "GET",
      headers: {
        authorization: `Bearer ${adminSession}`,
      },
    }))

    assert.equal(adminResponse.status, 200)
    assert.equal(adminResponse.headers.get("content-type"), "text/plain; charset=utf-8")
    assert.match(await adminResponse.text(), /Downcity Federation Instruction/)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation trusted identity can access admin endpoints without bearer token", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-trusted-admin-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    await base.health()

    const guestResponse = await base.fetch(new Request("http://localhost/v1/federation/instruction", {
      method: "GET",
    }))
    assert.equal(guestResponse.status, 401)

    const trustedResponse = await base.fetch(new Request("http://localhost/v1/federation/instruction", {
      method: "GET",
    }), {
      trusted_identity: { level: "admin" },
    })

    assert.equal(trustedResponse.status, 200)
    assert.match(await trustedResponse.text(), /Downcity Federation Instruction/)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation bootstraps internal secrets into the env table", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-env-bootstrap-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    await base.health()

    const envProvider = base.getService("env")._env
    assert.equal(envProvider.get("DOWNCITY_FEDERATION_ADMIN_SECRET_KEY"), undefined)
    assert.match(envProvider.get("DOWNCITY_FEDERATION_ID"), /^fed_/)
    assert.match(envProvider.get("BETTER_AUTH_SECRET"), /^better_auth_/)

    const items = await envProvider.list()
    assert.deepEqual(items.map((item) => item.key).sort(), [
      "BETTER_AUTH_SECRET",
      "DOWNCITY_FEDERATION_ID",
    ])

    const envTable = await base.table("env")
    const rows = await envTable.select()
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(typeof row.key, "string")
      assert.equal(typeof row.value, "string")
      assert.equal(typeof row.created_at, "string")
      assert.equal(typeof row.updated_at, "string")
    }

    const keyTable = await base.table("federation_auth_keys")
    const keyRows = await keyTable.select()
    assert.equal(keyRows.length, 1)
    assert.equal(keyRows[0].algorithm, "EdDSA")
    assert.equal(keyRows[0].status, "active")
    assert.equal(JSON.parse(keyRows[0].public_jwk).d, undefined)
    assert.equal(typeof JSON.parse(keyRows[0].private_jwk).d, "string")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("InstallableService route supports native Request handlers", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-native-route-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    base.use({
      id: "native",
      name: "Native Route Demo",
      install(ctx) {
        ctx.route({
          method: "ALL",
          path: "/echo/*",
          public: true,
          handler: {
            request: async (request) => Response.json({
              method: request.method,
              pathname: new URL(request.url).pathname,
              query: new URL(request.url).searchParams.get("q"),
              header: request.headers.get("x-demo"),
              body: await request.text(),
            }),
          },
        })
      },
    })

    await base.health()

    const response = await base.fetch(new Request("http://example.com/v1/native/echo/deep/path?q=yes", {
      method: "PUT",
      headers: {
        "content-type": "text/plain",
        "x-demo": "kept",
      },
      body: "raw body",
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      method: "PUT",
      pathname: "/v1/native/echo/deep/path",
      query: "yes",
      header: "kept",
      body: "raw body",
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation fetch runs middleware in order and remains bindable", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-middleware-order-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const events = []

    base.middle(async (ctx, next) => {
      events.push("a before")
      ctx.locals.request_id = "req_1"
      const response = await next()
      events.push("a after")
      const headers = new Headers(response.headers)
      headers.set("x-request-id", String(ctx.locals.request_id))
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    })
    base.middle(async (_ctx, next) => {
      events.push("b before")
      const response = await next()
      events.push("b after")
      return response
    })

    const fetch = base.fetch
    const response = await fetch(new Request("http://localhost/health"))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-request-id"), "req_1")
    assert.deepEqual(events, ["a before", "b before", "b after", "a after"])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation middleware can short-circuit before action body read", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-middleware-short-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    let action_called = false

    base.middle((ctx, next) => {
      const content_length = Number.parseInt(ctx.request.headers.get("content-length") ?? "0", 10)
      if (content_length > 3) {
        return Response.json({
          error: {
            message: "Request body too large",
            type: "request_too_large",
          },
        }, { status: 413 })
      }
      return next()
    })
    base.use({
      id: "demo.limit",
      name: "Demo Limit",
      install(ctx) {
        ctx.route({
          method: "POST",
          path: "/echo",
          auth: [],
          handler: async () => {
            action_called = true
            return { ok: true }
          },
        })
      },
    })

    const response = await base.fetch(new Request("http://localhost/v1/demo.limit/echo", {
      method: "POST",
      headers: {
        "content-length": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
    }))

    assert.equal(response.status, 413)
    assert.equal(action_called, false)
    assert.deepEqual(await response.json(), {
      error: {
        message: "Request body too large",
        type: "request_too_large",
      },
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation middleware reports duplicate next calls as middleware errors", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-middleware-next-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    base.middle(async (_ctx, next) => {
      await next()
      return await next()
    })

    const response = await base.fetch(new Request("http://localhost/health"))

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      error: {
        message: "next() called multiple times",
        type: "middleware_error",
      },
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService requires explicit model id for executable AI calls", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-ai-model-required-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const ai = new AIService()
    ai.use({
      id: "required-model",
      name: "Required Model",
      runtime: {
        actions: {
          text: async () => ({
            id: "msg_required",
            role: "assistant",
            parts: [{ type: "text", text: "ok", state: "done" }],
          }),
          image_create: async () => ({
            job_id: "img_required",
            status: "running",
          }),
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "running",
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${adminSession}`,
    }

    for (const input of [
      { path: "/v1/ai/text", body: { prompt: "hi" } },
      { path: "/v1/ai/chat/completions", body: { messages: [{ role: "user", content: "hi" }] } },
      { path: "/v1/ai/image/create", body: { prompt: "draw" } },
    ]) {
      const response = await base.fetch(new Request(`http://localhost${input.path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input.body),
      }))
      assert.equal(response.status, 422)
      assert.deepEqual(await response.json(), {
        error: {
          message: "model is required",
          type: "server_error",
        },
      })
    }
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService charges explicit provider charge lines", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-explicit-charge-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    const base = create_test_federation({ database: db })

    const ai = new AIService({
      credits: {
        async charge(input) {
          charges.push({
            user_id: input.user_id,
            credits: input.credits,
            note: input.note,
            metadata: input.metadata,
          })
        },
      },
    })
    ai.use({
      id: "priced-text",
      channel_id: "priced-provider",
      name: "Priced Text",
      runtime: {
        actions: {
          text: async () => ({
            output: {
              id: "msg_1",
              role: "assistant",
              parts: [{ type: "text", text: "ok", state: "done" }],
            },
            charge: {
              credits: 123,
              note: "provider charge",
              metadata: { channel_id: "priced-provider" },
            },
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)

    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priced-text", prompt: "hi" }),
    }))

    assert.equal(response.status, 200)
    assert.equal((await response.json()).id, "msg_1")
    assert.deepEqual(charges, [{
      user_id: "user_1",
      credits: 123,
      note: "provider charge",
      metadata: { channel_id: "priced-provider" },
    }])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService /stream keeps the model stream open until deferred charge settles", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-stream-charge-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    const base = create_test_federation({ database: db })
    const ai = new AIService({
      credits: {
        async charge(input) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          charges.push(input)
        },
      },
    })
    const provider_model = new MockLanguageModelV3({
      provider: "mock.provider",
      modelId: "stream-charge",
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({ type: "text-start", id: "text_1" })
            controller.enqueue({ type: "text-delta", id: "text_1", delta: "done" })
            controller.enqueue({ type: "text-end", id: "text_1" })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }),
    })
    ai.use({
      id: "stream-charge",
      channel_id: "stream-provider",
      name: "Stream Charge",
      runtime: {
        actions: {},
        stream: (_ctx, call) => provider_model.doStream(call),
      },
      bill: () => ({ credits: 321, note: "stream charge" }),
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminSession}` },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenBody.user_token}` },
      body: JSON.stringify({
        protocol: "downcity-language-model-v1",
        model_id: "stream-charge",
        call: {
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        },
      }),
    }))
    assert.deepEqual(charges, [])
    assert.match(await response.text(), /"type":"finish"/)
    assert.equal(charges.length, 1)
    assert.deepEqual(charges[0], {
      user_id: "user_1",
      credits: 321,
      note: "stream charge",
      ref: charges[0].ref,
      idempotency_key: charges[0].idempotency_key,
      source: "model_usage",
    })
    assert.match(charges[0].idempotency_key, /^ai:/)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService runs Credits precheck before provider actions", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-balance-precheck-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    let providerCalls = 0
    let precheckCalls = 0
    const base = create_test_federation({ database: db })

    const ai = new AIService({
      credits: {
        async precheck() {
          precheckCalls += 1
          const error = new Error("insufficient credits")
          error.statusCode = 402
          throw error
        },
        async charge() {},
      },
    })
    ai.use({
      id: "priced-text",
      channel_id: "priced-provider",
      name: "Priced Text",
      runtime: {
        actions: {
          text: async () => {
            providerCalls += 1
            return {
              id: "msg_1",
              role: "assistant",
              parts: [{ type: "text", text: "ok", state: "done" }],
            }
          },
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)

    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priced-text", prompt: "hi" }),
    }))

    assert.equal(response.status, 402)
    assert.equal(precheckCalls, 1)
    assert.equal(providerCalls, 0)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService uses provider bill when model bill is not set", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-provider-bill-"))

  class TestChannel extends AIChannel {
    async stream() {
      return create_text_stream()
    }

    bill(input) {
      return {
        credits: 222,
        note: "provider bill",
        ref: input.output.id,
        metadata: {
          model_id: input.metering?.model_id,
          channel_id: input.metering?.channel_id,
        },
      }
    }
  }

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    const base = create_test_federation({ database: db })

    const ai = new AIService({
      credits: {
        async charge(input) {
          charges.push({
            credits: input.credits,
            note: input.note,
            ref: input.ref,
            metadata: input.metadata,
          })
        },
      },
    })
    const provider = new TestChannel({ id: "test-provider" })
    ai.use(provider.model({
      id: "provider-billed-text",
      upstream_model: "provider-billed-text",
      name: "Provider Billed Text",
    }))
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })
    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "provider-billed-text", prompt: "hi" }),
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(charges, [{
      credits: 222,
      note: "provider bill",
      ref: charges[0].ref,
      metadata: {
        model_id: "provider-billed-text",
        channel_id: "test-provider",
      },
    }])
    assert.match(charges[0].ref, /^aiu_/)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService falls back to image-capable model for UIMessage image parts", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-fallback-ui-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const calls = []

    const ai = new AIService()
    ai.use([
      {
        id: "kimi",
        channel_id: "kimi-provider",
        name: "Kimi",
        runtime: {
          actions: {
            text: async () => {
              calls.push("kimi")
              return {
                id: "msg_kimi",
                role: "assistant",
                parts: [{ type: "text", text: "kimi" }],
              }
            },
          },
        },
      },
      {
        id: "deepseek",
        channel_id: "deepseek-provider",
        name: "DeepSeek",
        fallback: [{
          match: (media) => media.media_type.startsWith("image/") && media.url === "https://example.com/a.png",
          model_id: "kimi",
        }],
        runtime: {
          actions: {
            text: async (ctx) => {
              calls.push({
                model_id: ctx.metering?.model_id,
                fallback_from: ctx.metering?.metadata?.fallback_from,
                fallback_reason: ctx.metering?.metadata?.fallback_reason,
              })
              return {
                id: "msg_deepseek",
                role: "assistant",
                parts: [{ type: "text", text: "deepseek" }],
              }
            },
          },
        },
      },
    ])
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{
          role: "user",
          parts: [
            { type: "text", text: "看图" },
            { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
          ],
        }],
      }),
    }))

    assert.equal(response.status, 200)
    assert.equal((await response.json()).id, "msg_kimi")
    assert.deepEqual(calls, [
      "kimi",
    ])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService selects fallback rule by UIMessage file media type", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-fallback-media-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const calls = []

    const ai = new AIService()
    ai.use([
      {
        id: "vision",
        channel_id: "vision-provider",
        name: "Vision",
        runtime: {
          actions: {
            text: async () => {
              calls.push("vision")
              return {
                id: "msg_vision",
                role: "assistant",
                parts: [{ type: "text", text: "vision" }],
              }
            },
          },
        },
      },
      {
        id: "pdf-reader",
        channel_id: "pdf-provider",
        name: "PDF Reader",
        runtime: {
          actions: {
            text: async (ctx) => {
              calls.push({
                model_id: ctx.metering?.model_id,
                fallback_from: ctx.metering?.metadata?.fallback_from,
                fallback_reason: ctx.metering?.metadata?.fallback_reason,
                fallback_media_type: ctx.metering?.metadata?.fallback_media_type,
              })
              return {
                id: "msg_pdf",
                role: "assistant",
                parts: [{ type: "text", text: "pdf" }],
              }
            },
          },
        },
      },
      {
        id: "deepseek",
        channel_id: "deepseek-provider",
        name: "DeepSeek",
        fallback: [
          {
            match: (media) => media.media_type === "application/pdf" && media.filename === "paper.pdf",
            model_id: "pdf-reader",
          },
          {
            match: (media) => media.media_type.startsWith("image/"),
            model_id: "vision",
          },
        ],
        runtime: {
          actions: {
            text: async () => {
              calls.push("deepseek")
              return {
                id: "msg_deepseek",
                role: "assistant",
                parts: [{ type: "text", text: "deepseek" }],
              }
            },
          },
        },
      },
    ])
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{
          role: "user",
          parts: [
            { type: "text", text: "总结这个 PDF" },
            { type: "image", mediaType: "image/png", url: "https://example.com/legacy-image.png" },
            { type: "file", mediaType: "application/pdf", filename: "paper.pdf", url: "https://example.com/paper.pdf" },
          ],
        }],
      }),
    }))

    assert.equal(response.status, 200)
    assert.equal((await response.json()).id, "msg_pdf")
    assert.deepEqual(calls, [{
      model_id: "pdf-reader",
      fallback_from: "deepseek",
      fallback_reason: "input_requires_media",
      fallback_media_type: "application/pdf",
    }])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService falls back for OpenAI chat completions with image_url parts", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-fallback-openai-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const calls = []

    const ai = new AIService()
    ai.use([
      {
        id: "kimi",
        channel_id: "kimi-provider",
        name: "Kimi",
        runtime: {
          actions: {},
          stream: async () => {
            calls.push("kimi")
            return create_text_stream("kimi")
          },
        },
      },
      {
        id: "deepseek",
        channel_id: "deepseek-provider",
        name: "DeepSeek",
        fallback: [{
          match: (media) => media.media_type.startsWith("image/"),
          model_id: "kimi",
        }],
        runtime: {
          actions: {},
          stream: async (ctx) => {
            calls.push({
              model_id: ctx.metering?.model_id,
              fallback_from: ctx.metering?.metadata?.fallback_from,
              fallback_reason: ctx.metering?.metadata?.fallback_reason,
              fallback_media_type: ctx.metering?.metadata?.fallback_media_type,
            })
            return create_text_stream("deepseek")
          },
        },
      },
    ])
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({
        model: "deepseek",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "看图" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        }],
      }),
    }))

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.object, "chat.completion")
    assert.equal(body.choices[0].message.content, "kimi")
    assert.deepEqual(calls, [
      "kimi",
    ])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService lets model bill override provider bill", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-model-bill-override-"))

  class TestChannel extends AIChannel {
    async stream() {
      return create_text_stream()
    }

    bill() {
      return {
        credits: 222,
        note: "provider bill",
      }
    }
  }

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    const base = create_test_federation({ database: db })

    const ai = new AIService({
      credits: {
        async charge(input) {
          charges.push({
            credits: input.credits,
            note: input.note,
          })
        },
      },
    })
  const provider = new TestChannel({ id: "test-provider" })
    ai.use(provider.model({
      id: "model-billed-text",
      upstream_model: "model-billed-text",
      name: "Model Billed Text",
      bill() {
        return {
          credits: 333,
          note: "model bill",
        }
      },
    }))
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })
    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "model-billed-text", prompt: "hi" }),
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(charges, [{
      credits: 333,
      note: "model bill",
    }])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs advance and finish through provider result", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    const message = {
      id: "msg_image_1",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" }],
    }
    const jobs = new Map()
    let resultCalls = 0

    const ai = new AIService()
    ai.use({
      id: "echo-image",
      name: "Echo Image",
      runtime: {
        actions: {
          image_create: async () => {
            const job_id = "img_echo_1"
            jobs.set(job_id, {
              upstream_job_id: "up_echo_1",
            })
            return {
              job_id,
              status: "running",
              message: "running",
              poll_after_ms: 2000,
              metadata: jobs.get(job_id),
            }
          },
          image_fetch: async (ctx) => {
            resultCalls += 1
            const image_job = ctx.locals.ai_image_job
            const job_id = String(image_job.record.job_id)
            assert.deepEqual(image_job.state, { upstream_job_id: "up_echo_1" })
            return {
              job_id,
              status: "succeeded",
              result: message,
              message: "succeeded",
              metadata: jobs.get(job_id),
            }
          },
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "echo-image", prompt: "draw" }),
    }))

    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    assert.equal(created.status, "running")
    assert.equal(typeof created.job_id, "string")
    assert.deepEqual(queueMessages, [{
      service: "ai",
      action: "image/fetch",
      input: { job_id: created.job_id },
      delay_ms: 2000,
    }])

    await base.queue.call(queueMessages.shift())

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    assert.deepEqual(await resultResponse.json(), {
      job_id: created.job_id,
      status: "succeeded",
      result: message,
      message: "succeeded",
      metadata: { upstream_job_id: "up_echo_1" },
    })
    assert.equal(resultCalls, 1)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs require provider create and result actions", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-output-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    const message = {
      id: "msg_image_charged",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" }],
    }
    const jobs = new Map()

    const ai = new AIService()
    ai.use({
      id: "wrapped-image",
      name: "Wrapped Image",
      runtime: {
        actions: {
          image_create: async () => {
            const job_id = "img_wrapped_1"
            jobs.set(job_id, message)
            return {
              job_id,
              status: "running",
              poll_after_ms: 2000,
            }
          },
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "succeeded",
            result: jobs.get(String(ctx.input.job_id)),
            message: "succeeded",
            poll_after_ms: 2000,
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "wrapped-image", prompt: "draw" }),
    }))

    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    assert.equal(created.status, "running")
    await base.queue.call(queueMessages.shift())

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    assert.deepEqual(await resultResponse.json(), {
      job_id: created.job_id,
      status: "succeeded",
      result: message,
      message: "succeeded",
      poll_after_ms: 2000,
      metadata: {},
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs return provider result as-is", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-as-is-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    const message = {
      id: "msg_image_remote",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/png", url: "https://cdn.example.com/generated.png" }],
    }
    const jobs = new Map()

    const ai = new AIService()
    ai.use({
      id: "remote-image",
      name: "Remote Image",
      runtime: {
        actions: {
          image_create: async () => {
            const job_id = "img_remote_1"
            jobs.set(job_id, message)
            return {
              job_id,
              status: "running",
              poll_after_ms: 2000,
            }
          },
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "succeeded",
            result: jobs.get(String(ctx.input.job_id)),
            message: "succeeded",
            poll_after_ms: 2000,
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "remote-image", prompt: "draw" }),
    }))

    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    await base.queue.call(queueMessages.shift())

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    const body = await resultResponse.json()
    assert.equal(body.status, "succeeded")
    assert.equal(body.result.parts[0].url, "https://cdn.example.com/generated.png")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs store remote file parts through federation storage", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-storage-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    const stored = []
    base.storage({
      id: "mock",
      owns(url) {
        return String(url).startsWith("https://storage.example.com/")
      },
      async store(input) {
        stored.push(input)
        return { url: "https://storage.example.com/generated.png" }
      },
    })

    const message = {
      id: "msg_image_storage",
      role: "assistant",
      parts: [
        { type: "file", mediaType: "image/png", filename: "generated.png", url: "https://cdn.example.com/generated.png" },
        { type: "file", mediaType: "image/png", url: "https://storage.example.com/already.png" },
      ],
    }

    const ai = new AIService()
    ai.use({
      id: "stored-image",
      name: "Stored Image",
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_storage_1",
            status: "running",
            poll_after_ms: 2000,
          }),
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "succeeded",
            result: message,
            message: "succeeded",
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "stored-image", prompt: "draw" }),
    }))

    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    await base.queue.call(queueMessages.shift())

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    const body = await resultResponse.json()
    assert.deepEqual(stored, [{
      source_url: "https://cdn.example.com/generated.png",
      media_type: "image/png",
      filename: "generated.png",
    }])
    assert.equal(body.result.parts[0].url, "https://storage.example.com/generated.png")
    assert.equal(body.result.parts[1].url, "https://storage.example.com/already.png")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs keep source URL when storage fails", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-storage-fail-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    base.storage({
      id: "mock",
      owns() {
        return false
      },
      async store() {
        throw new Error("storage offline")
      },
    })

    const message = {
      id: "msg_image_storage_fail",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/png", url: "https://cdn.example.com/generated.png" }],
    }

    const ai = new AIService()
    ai.use({
      id: "storage-fail-image",
      name: "Storage Fail Image",
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_storage_fail_1",
            status: "running",
          }),
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "succeeded",
            result: message,
            message: "succeeded",
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "storage-fail-image", prompt: "draw" }),
    }))

    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    await base.queue.call(queueMessages.shift())

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    const body = await resultResponse.json()
    assert.equal(body.result.parts[0].url, "https://cdn.example.com/generated.png")
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image direct endpoint is not exposed", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-direct-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    useMemoryQueue(base)
    const ai = new AIService()
    ai.use({
      id: "image-only",
      name: "Image Only",
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_direct_1",
            status: "running",
          }),
          image_fetch: async (ctx) => ({
            job_id: String(ctx.input.job_id),
            status: "running",
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const response = await base.fetch(new Request("http://localhost/v1/ai/image", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "image-only", prompt: "draw" }),
    }))

    assert.equal(response.status, 404)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs reject incomplete provider actions", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-incomplete-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const ai = new AIService()
    ai.use({
      id: "incomplete-image",
      name: "Incomplete Image",
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_incomplete_1",
            status: "running",
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const response = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "incomplete-image", prompt: "draw" }),
    }))

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {
      error: {
        message: "Model incomplete-image does not support mode: image_create",
        type: "server_error",
      },
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService charges image jobs only after provider result succeeds", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-image-result-charge-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    let charge_attempts = 0
    let fetch_calls = 0
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)

    const ai = new AIService({
      credits: {
        async charge(input) {
          charge_attempts += 1
          if (charge_attempts <= 2) throw new Error("temporary credits failure")
          charges.push(input)
        },
      },
    })
    ai.use({
      id: "priced-image",
      channel_id: "image-provider",
      name: "Priced Image",
      bill(input) {
        return {
          credits: 777,
          note: "AI image result",
          ref: input.output.job_id,
          metadata: {
            service_id: "ai",
            action_id: input.metering?.metadata?.mode,
            model_id: input.metering?.model_id,
            channel_id: input.metering?.channel_id,
            image_count: input.metering?.image_count,
          },
        }
      },
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_priced_1",
            status: "running",
          }),
          image_fetch: async (ctx) => {
            fetch_calls += 1
            await new Promise((resolve) => setTimeout(resolve, 20))
            return {
              job_id: String(ctx.input.job_id),
              status: "succeeded",
              result: {
                id: "msg_priced_image",
                role: "assistant",
                parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" }],
              },
              metadata: {
                user_id: "user_1",
              },
            }
          },
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)

    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priced-image", prompt: "draw" }),
    }))

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.job_id, "img_priced_1")
    assert.deepEqual(charges, [])
    const fetch_message = queueMessages.shift()
    await base.queue.call(fetch_message)
    const settlement_message = queueMessages.shift()
    const settlement_table = await base.table("ai.settlement_jobs")
    await settlement_table.update({
      where: { usage_id: settlement_message.input.usage_id },
      values: { next_attempt_at: new Date(0).toISOString() },
    })
    await Promise.all([
      base.queue.call(settlement_message),
      base.queue.call(settlement_message),
    ])
    const second_settlement_message = queueMessages.shift()
    assert.equal(second_settlement_message.action, "settlement/process")
    await settlement_table.update({
      where: { usage_id: second_settlement_message.input.usage_id },
      values: { next_attempt_at: new Date(0).toISOString() },
    })
    await base.queue.call(second_settlement_message)

    const resultResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priced-image", job_id: body.job_id }),
    }))

    assert.equal(resultResponse.status, 200)
    const usage_id = charges[0].ref
    assert.match(usage_id, /^aiu_/)
    assert.deepEqual(charges, [{
      user_id: "user_1",
      idempotency_key: `ai:${usage_id}`,
      source: "model_usage",
      credits: 777,
      note: "AI image result",
      ref: usage_id,
      metadata: {
        service_id: "ai",
        action_id: "image/fetch",
        model_id: "priced-image",
        channel_id: "image-provider",
        image_count: 1,
      },
    }])
    assert.equal(charge_attempts, 3)
    assert.equal(fetch_calls, 1)

    const cachedResponse = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priced-image", job_id: body.job_id }),
    }))

    assert.equal(cachedResponse.status, 200)
    assert.equal((await cachedResponse.json()).status, "succeeded")
    assert.equal(charges.length, 1)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("AIService prefers action charge over model bill", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-ai-charge-priority-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const charges = []
    const base = create_test_federation({ database: db })

    const ai = new AIService({
      credits: {
        async charge(input) {
          charges.push({
            credits: input.credits,
            note: input.note,
          })
        },
      },
    })
    ai.use({
      id: "priority-text",
      channel_id: "priority-provider",
      name: "Priority Text",
      bill() {
        return {
          credits: 999,
          note: "model bill",
        }
      },
      runtime: {
        actions: {
          text: async () => ({
            output: {
              id: "msg_priority",
              role: "assistant",
              parts: [{ type: "text", text: "ok" }],
            },
            charge: {
              credits: 111,
              note: "action charge",
            },
          }),
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const city = await (await base.fetch(new Request("http://localhost/v1/bureaus/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ name: "Demo", server_url: "https://bureau.example.com" }),
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "priority-text", prompt: "hi" }),
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(charges, [{
      credits: 111,
      note: "action charge",
    }])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs can advance through result polling", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-poll-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    const message = {
      id: "msg_image_1",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" }],
    }
    let calls = 0
    const jobs = new Map()

    const ai = new AIService()
    ai.use({
      id: "step-image",
      name: "Step Image",
      runtime: {
        actions: {
          image_create: async (ctx) => {
            calls += 1
            const job_id = "up_1"
            jobs.set(job_id, { step: "created" })
            return {
              job_id,
              status: "running",
              message: "running",
              poll_after_ms: 10,
              metadata: jobs.get(job_id),
            }
          },
          image_fetch: async (ctx) => {
            calls += 1
            const image_job = ctx.locals.ai_image_job
            const job_id = String(image_job.record.job_id)
            if (image_job.state.step === "created") {
              const running = { step: "polled_once" }
              jobs.set(job_id, running)
              return {
                job_id,
                status: "running",
                message: "still running",
                poll_after_ms: 10,
                metadata: running,
              }
            }
            assert.deepEqual(image_job.state, { step: "polled_once" })
            const finished = { step: "finished" }
            jobs.set(job_id, finished)
            return {
              job_id,
              status: "succeeded",
              result: message,
              message: "succeeded",
              poll_after_ms: 2000,
              metadata: finished,
            }
          },
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "step-image", prompt: "draw" }),
    }))
    const created = await createResponse.json()
    assert.equal(created.status, "running")
    assert.equal(calls, 1)

    await base.queue.call(queueMessages.shift())
    const firstResult = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))
    assert.equal(firstResult.status, 200)
    assert.deepEqual(await firstResult.json(), {
      job_id: created.job_id,
      status: "running",
      message: "still running",
      poll_after_ms: 10,
      metadata: { step: "polled_once" },
    })
    assert.equal(calls, 2)

    await base.queue.call(queueMessages.shift())
    const result = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), {
      job_id: created.job_id,
      status: "succeeded",
      result: message,
      message: "succeeded",
      poll_after_ms: 2000,
      metadata: { step: "finished" },
    })
    assert.equal(calls, 3)

    const cached = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))
    assert.equal(cached.status, 200)
    assert.equal((await cached.json()).status, "succeeded")
    assert.equal(calls, 3)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation AI image jobs fail after max pending duration", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-image-job-timeout-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })
    const queueMessages = useMemoryQueue(base)
    let fetchCalls = 0

    const ai = new AIService({
      image_max_pending_duration_ms: 10,
    })
    ai.use({
      id: "timeout-image",
      name: "Timeout Image",
      runtime: {
        actions: {
          image_create: async () => ({
            job_id: "img_timeout_1",
            status: "running",
            message: "running",
            poll_after_ms: 10,
            metadata: { upstream_job_id: "up_timeout_1" },
          }),
          image_fetch: async (ctx) => {
            fetchCalls += 1
            return {
              job_id: String(ctx.input.job_id),
              status: "running",
              message: "still running",
              poll_after_ms: 10,
              metadata: { upstream_job_id: "up_timeout_1" },
            }
          },
        },
      },
    })
    base.use(ai)

    await base.health()
    const adminSession = await create_test_admin_session(base)
    const createResponse = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ model: "timeout-image", prompt: "draw" }),
    }))
    assert.equal(createResponse.status, 200)
    const created = await createResponse.json()
    assert.equal(created.status, "running")

    const oldIso = new Date(Date.now() - 60_000).toISOString()
    await db.query({
      sql: "UPDATE async_jobs SET created_at = ?, updated_at = ? WHERE job_id = ? AND job_type = ?",
      params: [oldIso, oldIso, created.job_id, "ai.image.generate"],
    })

    await base.queue.call(queueMessages.shift())
    assert.equal(fetchCalls, 0)

    const result = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminSession}`,
      },
      body: JSON.stringify({ job_id: created.job_id }),
    }))
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), {
      job_id: created.job_id,
      status: "failed",
      error: "upstream timeout",
      message: "upstream timeout",
      metadata: {
        upstream_job_id: "up_timeout_1",
        timeout_reason: "upstream timeout",
        max_pending_duration_ms: 10,
      },
    })
    assert.equal(queueMessages.length, 0)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation exposes service env requirements and env catalog", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-core-services-env-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    base.use({
      id: "payment.stripe",
      name: "Stripe Payment",
      env: [
        { key: "STRIPE_SECRET_KEY", description: "stripe secret", required: true },
        { key: "STRIPE_WEBHOOK_SECRET", description: "stripe webhook", required: false },
      ],
      install() {},
    })

    const ai = new AIService()
    ai.use({
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      env: {
        DEEPSEEK_API_KEY: "DeepSeek API Key",
      },
      runtime: {
        actions: {
          text: async () => ({ ok: true }),
        },
      },
    })
    base.use(ai)

    await base.health()

    const response = await base.fetch(new Request("http://localhost/v1/services", {
      method: "GET",
    }))
    assert.equal(response.status, 200)

    const body = await response.json()
    const stripe = body.items.find((item) => item.id === "payment.stripe")
    assert.deepEqual(stripe, {
      id: "payment.stripe",
      name: "Stripe Payment",
      env: [
        { key: "STRIPE_SECRET_KEY", description: "stripe secret", required: true },
        { key: "STRIPE_WEBHOOK_SECRET", description: "stripe webhook", required: false },
      ],
    })

    await base.getService("env")._env.upsert({ key: "STRIPE_SECRET_KEY", value: "sk_test" })
    const adminSession = await create_test_admin_session(base)

    const catalogResponse = await base.fetch(new Request("http://localhost/v1/env/catalog", {
      method: "GET",
      headers: {
        authorization: `Bearer ${adminSession}`,
      },
    }))
    assert.equal(catalogResponse.status, 200)

    const catalog = await catalogResponse.json()
    assert.deepEqual(catalog.items, [
      {
        id: "payment.stripe",
        name: "Stripe Payment",
        env: [
          { key: "STRIPE_SECRET_KEY", description: "stripe secret", required: true, configured: true, value_preview: "sk_test" },
          { key: "STRIPE_WEBHOOK_SECRET", description: "stripe webhook", required: false, configured: false },
        ],
      },
      {
        id: "ai-models",
        name: "AI Models",
        env: [
          {
            key: "DEEPSEEK_API_KEY",
            description: "DeepSeek API Key - used by DeepSeek V4 Flash",
            required: true,
            configured: false,
          },
        ],
      },
    ])
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("Federation refreshes runtime env only after explicit env refresh", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-city-env-refresh-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = create_test_federation({ database: db })

    base.use({
      id: "demo.env",
      name: "Demo Env",
      env: [
        { key: "GOOGLE_CLIENT_ID", description: "google client id", required: false },
      ],
      install(ctx) {
        const readEnv = ctx.env
        ctx.route({
          method: "GET",
          path: "/value",
          auth: [],
          handler: async (ctx) => ctx.jsonResponse({
            google_client_id: readEnv("GOOGLE_CLIENT_ID") ?? null,
          }),
        })
      },
    })

    await base.health()
    const adminSession = await create_test_admin_session(base)

    const beforeResponse = await base.fetch(new Request("http://localhost/v1/demo.env/value", {
      method: "GET",
    }))
    assert.equal(beforeResponse.status, 200)
    assert.deepEqual(await beforeResponse.json(), { google_client_id: null })

    const envTable = await base.table("env")
    const now = new Date().toISOString()
    await envTable.insert({
      key: "GOOGLE_CLIENT_ID",
      value: "google-client-id-live",
      source: "database",
      created_at: now,
      updated_at: now,
    })

    const cachedResponse = await base.fetch(new Request("http://localhost/v1/demo.env/value", {
      method: "GET",
    }))
    assert.equal(cachedResponse.status, 200)
    assert.deepEqual(await cachedResponse.json(), { google_client_id: null })

    const refreshResponse = await base.fetch(new Request("http://localhost/v1/env/refresh", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSession}`,
      },
    }))
    assert.equal(refreshResponse.status, 200)
    const refreshBody = await refreshResponse.json()
    assert.equal(refreshBody.success, true)
    assert.equal(typeof refreshBody.count, "number")
    assert.ok(refreshBody.count >= 1)

    const afterResponse = await base.fetch(new Request("http://localhost/v1/demo.env/value", {
      method: "GET",
    }))
    assert.equal(afterResponse.status, 200)
    assert.deepEqual(await afterResponse.json(), { google_client_id: "google-client-id-live" })

    const catalogResponse = await base.fetch(new Request("http://localhost/v1/env/catalog", {
      method: "GET",
      headers: {
        authorization: `Bearer ${adminSession}`,
      },
    }))
    assert.equal(catalogResponse.status, 200)

    const catalog = await catalogResponse.json()
    const demoScope = catalog.items.find((item) => item.id === "demo.env")
    assert.equal(demoScope.env[0].configured, true)
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

async function readEnvValue(base, key) {
  const envTable = await base.table("env")
  const rows = await envTable.select({ key })
  return rows[0]?.value ?? ""
}
