/**
 * AIChannel 显式领域输入回归测试。
 *
 * 验证语言与非语言 Channel 都不会收到完整 Federation Action Context。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { AIChannel, AIService } from "../bin/index.js"

/** 创建直接执行 AIService action 所需的最小 Context。 */
function create_context(input) {
  return {
    input: { ...input },
    locals: {},
    db: {},
    env: (key) => key === "UPSTREAM_API_KEY" ? "secret" : undefined,
    user: { user_id: "user_1" },
    bureau: {
      bureau_id: "bureau_1",
      name: "Test Bureau",
      state: "active",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      archived_at: "",
    },
  }
}

/** 创建完整的 LanguageModelV3 文本流。 */
function create_text_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue({ type: "text-start", id: "text_1" })
        controller.enqueue({ type: "text-delta", id: "text_1", delta: "ok" })
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

test("AIChannel stream receives explicit model, env, reasoning, and prepared call", async () => {
  let received_input
  let received_bill_input
  class TestChannel extends AIChannel {
    async stream(input) {
      received_input = input
      return create_text_stream()
    }

    bill(input) {
      received_bill_input = input
      return undefined
    }
  }

  const channel = new TestChannel({
    id: "openai",
    env_key: "UPSTREAM_API_KEY",
    ai_sdk_provider_id: "openai",
    ai_sdk_provider_options: { openai: { store: true } },
  })
  const ai = new AIService()
  ai.use(channel.model({
    id: "public-model",
    upstream_model: "vendor-model",
    name: "Public Model",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
    ai_sdk_provider_options: { openai: { store: false } },
  }))

  await ai.get("text").run(create_context({
    model: "public-model",
    prompt: "hello",
    reasoning_effort: "high",
  }))

  assert.deepEqual(Object.keys(received_input).sort(), ["call", "env", "model", "reasoning"])
  assert.deepEqual(received_input.model, {
    id: "public-model",
    upstream_model: "vendor-model",
  })
  assert.equal(received_input.env("UPSTREAM_API_KEY"), "secret")
  assert.deepEqual(received_input.reasoning, { effort: "high", source: "request" })
  assert.deepEqual(received_input.call.providerOptions, {
    openai: { store: false, reasoningEffort: "high" },
  })
  assert.deepEqual(Object.keys(received_bill_input).sort(), [
    "bureau_id",
    "metering",
    "model",
    "output",
    "usage_id",
    "user_id",
  ])
  assert.deepEqual(received_bill_input.model, received_input.model)
  assert.equal("db" in received_bill_input, false)
  assert.equal("locals" in received_bill_input, false)
})

test("AIChannel action receives a scoped input instead of Federation Context", async () => {
  let received_input
  class TestImageChannel extends AIChannel {
    async image_create(input) {
      received_input = input
      return { job_id: "image_1", status: "running" }
    }

    async image_fetch() {
      return { job_id: "image_1", status: "running" }
    }
  }

  const channel = new TestImageChannel({
    id: "images",
    env_key: "UPSTREAM_API_KEY",
  })
  const ai = new AIService()
  ai.use(channel.model({
    id: "public-image-model",
    upstream_model: "vendor-image-model",
    name: "Public Image Model",
  }))
  const context = create_context({ model: "public-image-model", prompt: "draw" })
  const resolved = ai.resolve({ model: "public-image-model", mode: "image_create" })

  await resolved.action(context)

  assert.deepEqual(Object.keys(received_input).sort(), [
    "bureau_id",
    "env",
    "input",
    "model",
    "user_id",
  ])
  assert.equal(received_input.input, context.input)
  assert.deepEqual(received_input.model, {
    id: "public-image-model",
    upstream_model: "vendor-image-model",
  })
  assert.equal(received_input.user_id, "user_1")
  assert.equal(received_input.bureau_id, "bureau_1")
  assert.equal("db" in received_input, false)
  assert.equal("locals" in received_input, false)
})
