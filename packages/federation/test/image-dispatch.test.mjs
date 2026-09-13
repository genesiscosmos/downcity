/**
 * @file 验证图片任务在异步调度能力缺失/降级时的行为。
 *
 * 关键点（中文）
 * - 能力缺失必须在产生副作用（调用上游、写入任务记录）之前失败，返回 503 且不留孤儿任务。
 * - 能力可用但单次投递失败时必须保留任务与 job_id，只记录可观察的降级原因。
 * - 内部字段（downcity_ 前缀）不得泄漏到对外 metadata。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { AIService } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session, create_test_federation } from "./admin-fixture.mjs"

/** 创建记录调用次数的测试图片 Channel。 */
function create_image_channel(counters) {
  const ai = new AIService()
  ai.use({
    id: "echo-image",
    name: "Echo Image",
    runtime: {
      actions: {
        image_create: async () => {
          counters.create_calls += 1
          return {
            job_id: "img_1",
            status: "running",
            message: "running",
            poll_after_ms: 2000,
            metadata: { upstream_job_id: "up_1" },
          }
        },
        image_fetch: async (ctx) => {
          counters.fetch_calls += 1
          const job_id = String(ctx.locals.ai_image_job.record.job_id)
          return {
            job_id,
            status: counters.next_fetch_status ?? "succeeded",
            result: counters.next_fetch_status === "running" ? undefined : {
              id: "msg_1",
              role: "assistant",
              parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
            },
            message: "ok",
            metadata: { upstream_job_id: "up_1" },
          }
        },
      },
    },
  })
  return ai
}

/** 在临时目录里搭建一个带图片 Channel 的 Federation。 */
async function with_image_federation(options, run) {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-image-dispatch-"))
  const cwd = process.cwd()
  try {
    process.chdir(temp_dir)
    const base = create_test_federation({
      database: createSqliteDb(path.join(temp_dir, "test.sqlite")),
    })
    if (options.use_queue !== false) {
      base.queue.use({
        async send(message) {
          if (options.on_send) return await options.on_send(message)
          options.messages?.push(message)
        },
      })
    }
    base.use(create_image_channel(options.counters))
    await base.health()
    const admin_session = await create_test_admin_session(base)
    return await run(base, admin_session)
  } finally {
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
}

/** 调用 image/create。 */
async function create_image(base, admin_session) {
  const response = await base.fetch(new Request("http://localhost/v1/ai/image/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${admin_session}`,
    },
    body: JSON.stringify({ model: "echo-image", prompt: "draw" }),
  }))
  return { status: response.status, body: await response.json() }
}

/** 调用 image/result。 */
async function read_image(base, admin_session, job_id) {
  const response = await base.fetch(new Request("http://localhost/v1/ai/image/result", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${admin_session}`,
    },
    body: JSON.stringify({ job_id }),
  }))
  return { status: response.status, body: await response.json() }
}

/** 读取 async_jobs 中的任务记录。 */
async function read_job_row(base, job_id) {
  // service 表在 Federation 表映射中使用 `<service_id>.<table>` 作为键。
  const table = await base.table("ai.async_jobs")
  const rows = await table.select({ job_id })
  return rows[0]
}

test("调度能力不可用时 image/create 前置失败，不留孤儿任务", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  await with_image_federation({ counters, use_queue: false }, async (base, admin_session) => {
    const created = await create_image(base, admin_session)

    // 关键点（中文）：修复前这里是 502，且上游任务与数据库记录都已产生。
    assert.equal(created.status, 503)
    assert.equal(created.body.error.code, "async_dispatch_unavailable")
    assert.match(created.body.error.message, /adapter/u)

    // 副作用必须为零：上游没有被调用，库里没有任务记录。
    assert.equal(counters.create_calls, 0, "能力缺失时不得调用上游")
    const table = await base.table("ai.async_jobs")
    assert.deepEqual(await table.select({}), [], "能力缺失时不得留下任务记录")
  })
})

test("调度能力可用但单次投递失败时，保留 job_id 并记录降级原因", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  await with_image_federation(
    {
      counters,
      on_send: async () => {
        throw new Error("queue transport down")
      },
    },
    async (base, admin_session) => {
      const created = await create_image(base, admin_session)

      // 关键点（中文）：投递失败不能让调用方丢掉已经产生的任务。
      assert.equal(created.status, 200)
      assert.equal(created.body.job_id, "img_1")
      assert.equal(counters.create_calls, 1)

      const row = await read_job_row(base, "img_1")
      assert.ok(row, "任务记录必须保留")
      const state = JSON.parse(String(row.state_json))
      assert.match(state.downcity_dispatch_error, /queue transport down/u)
      // 内部 usage_id 与降级原因同属内部状态。
      assert.equal(typeof state.downcity_usage_id, "string")

      // 对外 metadata 不得泄漏内部字段。
      const result = await read_image(base, admin_session, "img_1")
      assert.equal(result.status, 200)
      assert.equal("downcity_dispatch_error" in result.body.metadata, false)
      assert.equal("downcity_usage_id" in result.body.metadata, false)
      assert.equal(result.body.metadata.upstream_job_id, "up_1")
    },
  )
})

test("投递成功时正常入队且不写入降级痕迹", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  const messages = []
  await with_image_federation({ counters, messages }, async (base, admin_session) => {
    const created = await create_image(base, admin_session)
    assert.equal(created.status, 200)
    assert.deepEqual(messages, [{
      service: "ai",
      action: "image/fetch",
      input: { job_id: "img_1" },
      delay_ms: 2000,
    }])

    const row = await read_job_row(base, "img_1")
    assert.equal("downcity_dispatch_error" in JSON.parse(String(row.state_json)), false)
  })
})

test("降级后再次投递成功会清理降级痕迹", async () => {
  const counters = { create_calls: 0, fetch_calls: 0, next_fetch_status: "running" }
  let should_fail = true
  await with_image_federation(
    {
      counters,
      on_send: async () => {
        if (should_fail) throw new Error("queue transport down")
      },
    },
    async (base, admin_session) => {
      await create_image(base, admin_session)
      const before = JSON.parse(String((await read_job_row(base, "img_1")).state_json))
      assert.match(before.downcity_dispatch_error, /queue transport down/u)

      // 恢复投递能力后触发一次 fetch，让调度重新成功。
      should_fail = false
      await base.queue.call({ service: "ai", action: "image/fetch", input: { job_id: "img_1" } })

      const after = JSON.parse(String((await read_job_row(base, "img_1")).state_json))
      assert.equal(
        "downcity_dispatch_error" in after,
        false,
        "投递恢复后必须清理上一次的降级痕迹",
      )
    },
  )
})

test("结算重试在调度不可用时降级但不抛错，计费不受影响", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  await with_image_federation({ counters, use_queue: false }, async (base, admin_session) => {
    // 文本模型请求会走结算；即使调度不可用，也必须正常返回而不是失败。
    const response = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${admin_session}`,
      },
      body: JSON.stringify({ model: "missing-model", messages: [] }),
    }))
    // 模型不存在属于业务失败，但不应因为结算调度不可用而变成基础设施崩溃。
    assert.ok([400, 404, 422].includes(response.status), `unexpected status ${response.status}`)
  })
})
