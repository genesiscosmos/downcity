/**
 * CityModel 原生 LanguageModelV3 transport 契约测试。
 *
 * 覆盖客户端模型、Federation AIService、Provider runtime、工具事件、reasoning、
 * usage、计费和非流式聚合的完整内部链路。
 */

import assert from "node:assert/strict"
import test from "node:test"
import { MockLanguageModelV3 } from "ai/test"

import { AIChannel, AIService, CityModel } from "../bin/index.js"
import { prepare_city_language_model_call } from "../bin/service/ai/language-model-stream.js"

const usage = {
  inputTokens: { total: 12, noCache: 8, cacheRead: 4, cacheWrite: 0 },
  outputTokens: { total: 7, text: 5, reasoning: 2 },
}

/** 创建 Provider 返回的完整 LanguageModelV3 流。 */
function create_provider_stream() {
  const parts = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "response_1", modelId: "upstream-model", timestamp: new Date("2026-07-17T00:00:00.000Z") },
    { type: "reasoning-start", id: "reasoning_1" },
    { type: "reasoning-delta", id: "reasoning_1", delta: "think" },
    { type: "reasoning-end", id: "reasoning_1" },
    { type: "text-start", id: "text_1" },
    { type: "text-delta", id: "text_1", delta: "done" },
    { type: "text-end", id: "text_1" },
    { type: "tool-input-start", id: "call_1", toolName: "ping" },
    { type: "tool-input-delta", id: "call_1", delta: "{\"value\":\"hello\"}" },
    { type: "tool-input-end", id: "call_1" },
    {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "ping",
      input: "{\"value\":\"hello\"}",
      providerMetadata: { openai: { itemId: "fc_1" } },
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage,
      providerMetadata: { mock: { apiFamily: "responses" } },
    },
  ]
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

/** 创建直接执行 AIService action 所需的最小 Context。 */
function create_context(input, signal) {
  return {
    input: { ...input },
    locals: {},
    db: {},
    user: { user_id: "user_1", metadata: {} },
    env: () => "test-api-key",
    request: new Request("https://federation.test/v1/ai/stream", {
      method: "POST",
      signal,
    }),
  }
}

test("Federation removes client providerOptions before Provider execution", () => {
  const abort_controller = new AbortController()
  const call = prepare_city_language_model_call({
    prompt: [],
    providerOptions: {
      openai: { store: true },
      custom: { unsafe: true },
    },
  }, abort_controller.signal)

  assert.equal(call.abortSignal, abort_controller.signal)
  assert.equal("providerOptions" in call, false)
})

test("CityModel directly streams through Federation LanguageModelV3 runtime", async () => {
  const charges = []
  const requests = []
  const contexts = []
  let received_options
  const provider_model = new MockLanguageModelV3({
    provider: "mock.responses",
    modelId: "upstream-model",
    doStream: async (options) => {
      received_options = options
      return create_provider_stream()
    },
  })
  const ai = new AIService({
    credits: {
      charge: async (input) => charges.push(input),
    },
  })
  const channel = new (class extends AIChannel {
    async stream(input) {
      return provider_model.doStream(input.call)
    }
  })({
    id: "mock",
    env: {},
    env_key: "MOCK_API_KEY",
    ai_sdk_provider_id: "mock",
  })
  ai.use(channel.model({
    id: "city-model",
    upstream_model: "upstream-model",
    name: "City Model",
    reasoning: {
      efforts: [{ id: "high", name: "High" }],
    },
    bill: () => ({ credits: 3, note: "language model test" }),
  }))
  const action = ai.get("stream")
  assert.ok(action)
  assert.equal(ai.get("language-model/stream"), undefined)
  const catalog = AIService.listModels(ai, {
    env: () => "test-api-key",
    identity: "user",
  })
  assert.ok(catalog[0].modalities.includes("stream"))

  const model = new CityModel({
    descriptor: {
      id: "city-model",
      name: "City Model",
      description: "Native City model",
      modalities: ["text", "stream"],
      tags: [],
      meta: {},
    },
    request_stream: async (request, signal) => {
      requests.push(request)
      const ctx = create_context(request, signal)
      contexts.push(ctx)
      return action.run(ctx)
    },
  })
  const abort_controller = new AbortController()
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "run ping" }] }],
    tools: [{
      type: "function",
      name: "ping",
      description: "Ping",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    }],
    abortSignal: abort_controller.signal,
    providerOptions: {
      openai: { store: false },
      downcity: { reasoningEffort: "high" },
    },
  })
  const received_parts = []
  const reader = result.stream.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    received_parts.push(chunk.value)
  }

  assert.equal(requests[0].protocol, "downcity-language-model-v1")
  assert.equal(requests[0].model_id, "city-model")
  assert.equal(requests[0].reasoning_effort, "high")
  assert.equal("providerOptions" in requests[0].call, false)
  assert.deepEqual(received_options.providerOptions, {
    mock: { reasoningEffort: "high" },
  })
  assert.equal(received_options.abortSignal, contexts[0].request.signal)
  assert.equal(received_parts.find((part) => part.type === "reasoning-delta")?.delta, "think")
  assert.equal(received_parts.find((part) => part.type === "tool-call")?.toolName, "ping")
  assert.deepEqual(received_parts.find((part) => part.type === "tool-call")?.providerMetadata, {
    openai: { itemId: "fc_1" },
  })
  assert.deepEqual(received_parts.find((part) => part.type === "finish")?.usage, usage)
  assert.equal(charges.length, 1)
  assert.equal(charges[0].credits, 3)
  assert.equal(contexts[0].metering.input_tokens, 8)
  assert.equal(contexts[0].metering.cached_tokens, 4)
  assert.equal(contexts[0].metering.output_tokens, 7)
  assert.equal(contexts[0].metering.reasoning_tokens, 2)
})

test("CityModel doGenerate aggregates native text, reasoning and tool calls", async () => {
  const model = new CityModel({
    descriptor: {
      id: "aggregate-model",
      name: "Aggregate Model",
      description: "Aggregation test",
      modalities: ["text"],
      tags: [],
      meta: {},
    },
    request_stream: async () => {
      const encoder = new TextEncoder()
      const events = await create_provider_stream_events()
      return new Response(new ReadableStream({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          controller.close()
        },
      }), { status: 200 })
    },
  })

  const result = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  })
  assert.deepEqual(result.content.map((part) => part.type), ["reasoning", "text", "tool-call"])
  assert.equal(result.content[0].text, "think")
  assert.equal(result.content[1].text, "done")
  assert.equal(result.content[2].toolCallId, "call_1")
  assert.deepEqual(result.content[2].providerMetadata, {
    openai: { itemId: "fc_1" },
  })
  assert.deepEqual(result.finishReason, { unified: "tool-calls", raw: "tool_calls" })
  assert.deepEqual(result.usage, usage)
  assert.equal(result.response.id, "response_1")
  assert.ok(result.response.timestamp instanceof Date)
})

/** 创建不依赖 AIService 的 City transport 测试事件。 */
function create_provider_stream_events() {
  const stream = create_provider_stream().stream
  return read_all(stream).then((parts) => parts.map((part) => ({
    protocol: "downcity-language-model-v1",
    part: encode_test_value(part),
  })))
}

/** 读取完整流。 */
async function read_all(stream) {
  const output = []
  const reader = stream.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return output
    output.push(chunk.value)
  }
}

/** 测试侧实现 Date 的 transport 标签编码。 */
function encode_test_value(value) {
  if (value instanceof Date) {
    return { __downcity_transport_type: "date", value: value.toISOString() }
  }
  if (Array.isArray(value)) return value.map(encode_test_value)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode_test_value(item)]))
  }
  return value
}
