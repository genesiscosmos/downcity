/**
 * @file 验证 Federation 异步调度能力的三态模型与进程内调度行为。
 *
 * 关键点（中文）
 * - 长期运行宿主（Node）必须默认具备进程内调度能力，图像生成等异步任务才能入队。
 * - 请求级隔离运行时（Cloudflare Workers 等）在未注册外部队列时必须报「不可用」，
 *   不得静默降级为进程内定时器，否则任务会在响应结束后悄悄丢失。
 * - 生命周期必须闭合：dispose() 之后不再调度，也不重建适配器。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { Federation, FederationQueueUnavailableError } from "../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_federation } from "./admin-fixture.mjs"

/** 模拟请求级运行时：临时替换 navigator.userAgent。 */
async function with_user_agent(user_agent, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: user_agent },
    configurable: true,
    writable: true,
  })
  try {
    return await run()
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original)
    else delete globalThis.navigator
  }
}

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

/** 轮询等待条件成立，避免依赖固定 sleep。 */
async function wait_for(predicate, timeout_ms = 2000) {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return predicate()
}

test("Node 宿主默认具备进程内调度能力，并能真实投递消息", async () => {
  const calls = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  register_recorder(federation, calls)
  try {
    await federation.health()

    // 关键点（中文）：修复前这里是 "unavailable"，图像生成会以 502 失败。
    assert.equal(federation.queue.state, "in_process")
    assert.equal(federation.queue.is_available(), true)
    federation.queue.require_available()

    await federation.queue.send({ service: "recorder", action: "record", input: { n: 1 } })
    assert.ok(await wait_for(() => calls.length === 1), "进程内调度应真实执行 action")
    assert.deepEqual(calls, [{ n: 1 }])
  } finally {
    await federation.dispose()
  }
})

test("delay_ms 生效：延迟消息不会立即执行", async () => {
  const calls = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  register_recorder(federation, calls)
  try {
    await federation.health()
    await federation.queue.send({
      service: "recorder",
      action: "record",
      input: { delayed: true },
      delay_ms: 60,
    })
    assert.deepEqual(calls, [], "延迟消息不应在调度时立即执行")
    assert.ok(await wait_for(() => calls.length === 1), "延迟到期后应执行")
  } finally {
    await federation.dispose()
  }
})

test("显式注册 adapter 时进入 external，消息交给外部实现", async () => {
  const sent = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  federation.queue.use({
    async send(message) {
      sent.push(message)
    },
  })
  try {
    await federation.health()
    assert.equal(federation.queue.state, "external")
    await federation.queue.send({ service: "s", action: "a", input: { x: 1 } })
    assert.deepEqual(sent, [{ service: "s", action: "a", input: { x: 1 } }])
  } finally {
    await federation.dispose()
  }
})

test("请求级运行时未注册 adapter 时判定为不可用并前置失败", async () => {
  await with_user_agent("Cloudflare-Workers", async () => {
    const federation = new Federation({ database: createSqliteDb(":memory:") })
    try {
      await federation.health()
      assert.equal(federation.queue.state, "unavailable")
      assert.equal(federation.queue.is_available(), false)

      // 关键点（中文）：错误必须带稳定 code 且指出缺失项，便于服务侧映射为 503。
      assert.throws(
        () => federation.queue.require_available(),
        (error) => {
          assert.ok(error instanceof FederationQueueUnavailableError)
          assert.equal(error.code, "async_dispatch_unavailable")
          assert.match(error.message, /queue adapter/u)
          return true
        },
      )

      await assert.rejects(
        () => federation.queue.send({ service: "s", action: "a" }),
        (error) => {
          assert.equal(error.code, "async_dispatch_unavailable")
          return true
        },
      )
    } finally {
      await federation.dispose()
    }
  })
})

test("请求级运行时注册 adapter 后恢复可用", async () => {
  await with_user_agent("Cloudflare-Workers", async () => {
    const sent = []
    const federation = new Federation({ database: createSqliteDb(":memory:") })
    try {
      await federation.health()
      assert.equal(federation.queue.state, "unavailable")
      federation.queue.use({
        async send(message) {
          sent.push(message)
        },
      })
      assert.equal(federation.queue.state, "external")
      assert.equal(federation.queue.is_available(), true)
      await federation.queue.send({ service: "s", action: "a" })
      assert.equal(sent.length, 1)
    } finally {
      await federation.dispose()
    }
  })
})

test("dispose 后不再调度，也不重建适配器", async () => {
  const calls = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  register_recorder(federation, calls)
  try {
    await federation.health()
    await federation.queue.send({ service: "recorder", action: "record" })
    assert.ok(await wait_for(() => calls.length === 1))

    await federation.dispose()
    assert.equal(calls.length, 1, "dispose 不应触发额外调度")

    // 关键点（中文）：释放是终态，必须拒绝新消息而不是悄悄重建调度器。
    await assert.rejects(
      () => federation.queue.send({ service: "recorder", action: "record" }),
      /has been disposed/u,
    )
    // 幂等：重复释放不报错。
    await federation.dispose()
  } catch (error) {
    await federation.dispose()
    throw error
  }
})

test("dispose 清理未触发的延迟消息", async () => {
  const calls = []
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  register_recorder(federation, calls)
  await federation.health()
  await federation.queue.send({
    service: "recorder",
    action: "record",
    delay_ms: 120,
  })
  await federation.dispose()
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.deepEqual(calls, [], "已释放的定时器不应再触发")
})

test("进程内投递失败只上报，不产生未处理的 Promise 拒绝", async () => {
  const reported = []
  const original_error = console.error
  console.error = (...args) => {
    reported.push(args.join(" "))
  }
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  try {
    await federation.health()
    // 未知 action 会让 queue.call 抛错，模拟投递阶段失败。
    await federation.queue.send({ service: "missing", action: "nope" })
    assert.ok(
      await wait_for(() => reported.length === 1),
      "投递失败必须显式上报",
    )
    assert.match(reported[0], /in-process delivery failed/u)
  } finally {
    console.error = original_error
    await federation.dispose()
  }
})

test("health() 暴露异步调度能力状态，便于部署期发现配置缺失", async () => {
  const federation = new Federation({ database: createSqliteDb(":memory:") })
  try {
    const status = await federation.health()
    assert.equal(status.queue, "in_process")
  } finally {
    await federation.dispose()
  }

  await with_user_agent("Cloudflare-Workers", async () => {
    const edge = new Federation({ database: createSqliteDb(":memory:") })
    try {
      const status = await edge.health()
      assert.equal(status.queue, "unavailable")
    } finally {
      await edge.dispose()
    }
  })
})

test("管理员 fixture 创建的 Federation 同样具备进程内调度能力", async () => {
  const calls = []
  const federation = create_test_federation({ database: createSqliteDb(":memory:") })
  register_recorder(federation, calls)
  try {
    await federation.health()
    assert.equal(federation.queue.state, "in_process")
  } finally {
    await federation.dispose()
  }
})
