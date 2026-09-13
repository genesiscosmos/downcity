import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import {
  Federation,
  AIService,
  AIChannel,
  InstallableService,
} from "../bin/index.js"
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
  return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "model_start", request_id: "req_test", model_id: "test-model" })
    controller.enqueue({ type: "text_start", content_id: "text_1" })
    controller.enqueue({ type: "text_delta", content_id: "text_1", delta: text })
    controller.enqueue({ type: "text_finish", content_id: "text_1" })
    controller.enqueue({ type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
    controller.enqueue({ type: "model_finish", finish_reason: "stop" })
    controller.close()
  } }) }
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
      parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
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
      parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
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
      parts: [{ type: "file", media_type: "image/png", url: "https://cdn.example.com/generated.png" }],
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
        { type: "file", media_type: "image/png", filename: "generated.png", url: "https://cdn.example.com/generated.png" },
        { type: "file", media_type: "image/png", url: "https://storage.example.com/already.png" },
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
      parts: [{ type: "file", media_type: "image/png", url: "https://cdn.example.com/generated.png" }],
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
    // 关键点（中文）：本用例验证的是「上游不支持 image_create 模式」的业务校验，
    // 因此需显式提供调度能力，避免被「能力缺失」的前置失败抢先命中。
    base.queue.use({ async send() {} })

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
                parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
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
      parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
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
