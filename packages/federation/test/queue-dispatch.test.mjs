/**
 * @file 验证 Federation 异步调度能力的边界。
 *
 * 关键点（中文）
 * - 能力只有一个来源：宿主显式注册的 adapter。Federation 不判断宿主平台，
 *   也不拥有任何隐式兜底策略。
 * - 未注册 adapter 时必须前置失败并带稳定 `code`，让调用方能在产生副作用之前
 *   区分「系统能力缺失」与「业务失败」，而不是等到运行中途才报 5xx。
 * - adapter 的发送失败必须向上冒泡，不得被吞成"看起来成功"。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { Federation, FederationQueueUnavailableError } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

/** 注册一个把调用输入记录到数组里的异步 action。 */
function register_recorder(federation, calls) {
  federation.use({
    id: "recorder",
    name: "Recorder",
    install(ctx) {
      ctx.route({
        method: "POST",
        path: "record",
        public: true,
        handler: async (request) => {
          calls.push(await request.json())
          return request.jsonResponse({ ok: true }, 200)
        },
      })
    },
  })
}

/** 在内存数据库上搭建一个 Federation，并在结束时释放。 */
async function with_federation(run) {
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  try {
    await federation.health()
    return await run(federation)
  } finally {
    await federation.dispose()
  }
}

test("未注册 adapter 时能力不可用，并以带 code 的错误前置失败", async () => {
  await with_federation(async (federation) => {
    assert.equal(federation.queue.is_available(), false)

    assert.throws(
      () => federation.queue.require_available(),
      (error) => {
        assert.ok(error instanceof FederationQueueUnavailableError)
        assert.equal(error.code, "async_dispatch_unavailable")
        return true
      },
    )

    // send 同样前置失败：不接受"先排队再报错"。
    await assert.rejects(
      () => federation.queue.send({ service: "ai", action: "image/fetch", input: { job_id: "j" } }),
      (error) => error.code === "async_dispatch_unavailable",
    )
  })
})

test("注册 adapter 后能力可用，消息原样交给 adapter", async () => {
  const messages = []
  await with_federation(async (federation) => {
    federation.queue.use({
      async send(message) {
        messages.push(message)
      },
    })

    assert.equal(federation.queue.is_available(), true)
    assert.doesNotThrow(() => federation.queue.require_available())

    const message = { service: "ai", action: "image/fetch", input: { job_id: "j" }, delay_ms: 2000 }
    await federation.queue.send(message)
    assert.deepEqual(messages, [message])
  })
})

test("adapter 发送失败向上冒泡，不被吞成成功", async () => {
  await with_federation(async (federation) => {
    federation.queue.use({
      async send() {
        throw new Error("queue transport down")
      },
    })

    await assert.rejects(
      () => federation.queue.send({ service: "ai", action: "image/fetch" }),
      /queue transport down/u,
    )
  })
})

test("health() 报告调度能力可用性", async () => {
  await with_federation(async (federation) => {
    assert.equal((await federation.health()).queue, false)
    federation.queue.use({ async send() {} })
    assert.equal((await federation.health()).queue, true)
  })
})

test("queue.call 复用现有 Action 执行模型", async () => {
  const calls = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  try {
    // 关键点（中文）：InstallableService 的 route 在初始化阶段注册，
    // 因此必须在 health() 之前完成 use，否则 queue.call 找不到对应 action。
    register_recorder(federation, calls)
    federation.queue.use({ async send() {} })
    await federation.health()

    await federation.queue.call({
      service: "recorder",
      action: "record",
      input: { n: 1 },
    })

    assert.deepEqual(calls, [{ n: 1 }])
  } finally {
    await federation.dispose()
  }
})
