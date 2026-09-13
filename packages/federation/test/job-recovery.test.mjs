/**
 * @file 验证 AI 异步任务恢复：停滞判定、重新入队、周期驱动与自驱动边界。
 *
 * 关键点（中文）
 * - 恢复只接管「停滞」的任务：正常路径仍由任务自身的 poll_after_ms 驱动，
 *   全量重排会在每个周期额外多打一次上游。
 * - 长期运行宿主（in_process）由 SDK 自驱动恢复循环；请求级运行时只接受
 *   部署侧 cron / scheduled handler 触发同一动作，不在 SDK 内隐式改用定时器。
 * - 调度能力不可用时必须报告「未启动恢复」，不得静默假装已经恢复。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { AIService } from "../bin/index.js"
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

/** 创建记录调用次数的测试图片 Channel。 */
function create_image_channel(counters, service_options = {}) {
  const ai = new AIService(service_options)
  ai.use({
    id: "echo-image",
    name: "Echo Image",
    runtime: {
      actions: {
        image_create: async () => {
          counters.create_calls += 1
          return { job_id: "img_created", status: "running", poll_after_ms: 2000 }
        },
        image_fetch: async (ctx) => {
          counters.fetch_calls += 1
          const job_id = String(ctx.locals.ai_image_job.record.job_id)
          return {
            job_id,
            status: "succeeded",
            result: {
              id: "msg_1",
              role: "assistant",
              parts: [{ type: "file", media_type: "image/png", url: "data:image/png;base64,abc" }],
            },
            message: "ok",
          }
        },
      },
    },
  })
  return ai
}

/** 在临时目录里搭建带图片 Channel 的 Federation，并在结束时释放。 */
async function with_recovery_federation(options, run) {
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-job-recovery-"))
  const cwd = process.cwd()
  let base
  try {
    process.chdir(temp_dir)
    base = create_test_federation({
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
    base.use(create_image_channel(options.counters, options.service_options))
    await base.health()
    return await run(base)
  } finally {
    if (base) await base.dispose()
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
}

/**
 * 向 async_jobs 直接写入一条图片任务记录。
 *
 * 关键点（中文）
 * - 测试从「事实源记录」出发，精确控制 status / updated_at / poll_after_ms，
 *   以覆盖恢复流程的停滞判定，而不依赖上游任务的创建路径。
 */
async function seed_image_job(base, overrides) {
  const table = await base.table("ai.async_jobs")
  const now = new Date().toISOString()
  await table.insert({
    job_id: overrides.job_id,
    job_type: overrides.job_type ?? "ai.image.generate",
    status: overrides.status ?? "running",
    input_json: JSON.stringify({ model: "echo-image", prompt: "draw" }),
    state_json: JSON.stringify(overrides.state ?? {}),
    result_json: overrides.result_json ?? null,
    error: null,
    message: null,
    poll_after_ms: overrides.poll_after_ms ?? "2000",
    bureau_id: null,
    user_id: null,
    service_id: "ai",
    model_id: overrides.model_id ?? "echo-image",
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  })
}

/** 读取 async_jobs 中的任务记录。 */
async function read_job_row(base, job_id) {
  const table = await base.table("ai.async_jobs")
  const rows = await table.select({ job_id })
  return rows[0]
}

/** 轮询等待条件成立；用于观察自驱动恢复循环的最终效果。 */
async function wait_for(predicate, timeout_ms = 5000) {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

/** 一小时前的 ISO 时间，用于构造「已经停滞」的任务记录。 */
function an_hour_ago() {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString()
}

test("恢复动作只重新入队停滞的非终态图片任务", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  const messages = []
  await with_recovery_federation({ counters, messages }, async (base) => {
    await seed_image_job(base, { job_id: "img_stalled", status: "running", updated_at: an_hour_ago() })
    // 刚有进展的任务仍由自身 poll_after_ms 驱动，恢复流程不得抢跑。
    await seed_image_job(base, { job_id: "img_fresh", status: "running" })
    // 终态任务与其它 job_type 都不属于图片恢复范围。
    await seed_image_job(base, {
      job_id: "img_done",
      status: "succeeded",
      updated_at: an_hour_ago(),
      result_json: JSON.stringify({ role: "assistant", parts: [] }),
    })
    await seed_image_job(base, {
      job_id: "img_other_type",
      job_type: "ai.video.generate",
      status: "running",
      updated_at: an_hour_ago(),
    })

    const result = await base.queue.call({ service: "ai", action: "jobs/resume", input: {} })

    assert.deepEqual(
      messages.map((message) => ({
        service: message.service,
        action: message.action,
        input: message.input,
      })),
      [{ service: "ai", action: "image/fetch", input: { job_id: "img_stalled" } }],
    )
    assert.deepEqual(result, { resumed_image_jobs: 1, recovered_settlements: 0 })
  })
})

test("恢复动作按 loop 续排下一次，非 loop 调用不续排", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  const messages = []
  await with_recovery_federation({ counters, messages }, async (base) => {
    await base.queue.call({ service: "ai", action: "jobs/resume", input: { loop: true } })
    assert.equal(messages.length, 1)
    assert.equal(messages[0].action, "jobs/resume")
    assert.deepEqual(messages[0].input, { loop: true })
    assert.ok(messages[0].delay_ms > 0, "续排必须带正延迟，避免忙轮询")

    messages.length = 0
    await base.queue.call({ service: "ai", action: "jobs/resume", input: {} })
    assert.deepEqual(messages, [], "非自驱动调用不得续排")
  })
})

test("长期运行宿主自动引导恢复循环并接管停滞任务", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  await with_recovery_federation(
    { counters, use_queue: false, service_options: { reconcile_interval_ms: 50 } },
    async (base) => {
      // 关键点（中文）：不手动触发任何动作，只依赖 SDK 自驱动的恢复循环。
      await seed_image_job(base, { job_id: "img_stalled", status: "running", updated_at: an_hour_ago() })

      const resumed = await wait_for(async () => counters.fetch_calls >= 1)
      assert.ok(resumed, "恢复循环必须自动接管停滞的图片任务")

      const row = await read_job_row(base, "img_stalled")
      assert.equal(row.status, "succeeded")
    },
  )
})

test("恢复流程把超过最大 pending 时间的任务收敛为失败", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  await with_recovery_federation(
    { counters, use_queue: false, service_options: { reconcile_interval_ms: 50 } },
    async (base) => {
      await seed_image_job(base, {
        job_id: "img_timed_out",
        status: "running",
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updated_at: an_hour_ago(),
      })

      const failed = await wait_for(
        async () => (await read_job_row(base, "img_timed_out")).status === "failed",
      )
      assert.ok(failed, "超过最大 pending 时间的任务必须被收敛为失败")

      const row = await read_job_row(base, "img_timed_out")
      assert.equal(row.error, "upstream timeout")
      assert.equal(counters.fetch_calls, 0, "已超时的任务不应再请求上游")
    },
  )
})

test("请求级运行时不由 SDK 自驱动恢复循环", async () => {
  const counters = { create_calls: 0, fetch_calls: 0 }
  const messages = []
  await with_user_agent("Cloudflare-Workers", async () => {
    await with_recovery_federation({ counters, messages }, async (base) => {
      const health = await base.health()
      assert.equal(health.queue, "external")
      // 关键点（中文）：周期恢复属于部署契约，SDK 不得用进程内定时器替它做决定。
      assert.deepEqual(messages, [])
    })
  })
})

test("调度能力不可用时报告未启动恢复循环", async () => {
  const warnings = []
  const original_warn = console.warn
  console.warn = (...args) => {
    warnings.push(args.join(" "))
  }
  const counters = { create_calls: 0, fetch_calls: 0 }
  try {
    await with_user_agent("Cloudflare-Workers", async () => {
      await with_recovery_federation({ counters, use_queue: false }, async (base) => {
        const health = await base.health()
        assert.equal(health.queue, "unavailable")
      })
    })
  } finally {
    console.warn = original_warn
  }
  assert.ok(
    warnings.some((line) => line.includes("job recovery loop not started")),
    "调度不可用时必须留下可观察的上报",
  )
})
