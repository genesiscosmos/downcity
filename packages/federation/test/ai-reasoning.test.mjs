/**
 * AIService 推理强度协议测试。
 *
 * 覆盖模型注册、目录公开、fallback 后解析、Provider 转换和 OpenAI-compatible 请求体。
 */

import assert from "node:assert/strict"
import test from "node:test"
import { MockLanguageModelV3 } from "ai/test"

import {
  AIService,
  AIChannel,
  read_resolved_reasoning,
} from "../bin/index.js"

/** 创建直接执行 AIService action 所需的最小 Context。 */
function create_context(input, env = () => undefined) {
  return {
    input: { ...input },
    locals: {},
    db: {},
    env,
  }
}

/** 返回可用于断言的固定 UIMessage。 */
function create_message(metadata = {}) {
  return {
    id: "msg_reasoning",
    role: "assistant",
    parts: [{ type: "text", text: "ok", state: "done" }],
    metadata,
  }
}

/** 创建可被 LanguageModelV3 消费的固定文本流。 */
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

test("AIService validates reasoning configuration during model registration", () => {
  const ai = new AIService()

  assert.throws(() => ai.use({
    id: "invalid-reasoning",
    name: "Invalid Reasoning",
    reasoning: {
      efforts: [
        { id: "high", name: "High" },
        { id: "high", name: "Duplicate" },
      ],
      default_effort: "medium",
    },
    runtime: {
      actions: { text: async () => create_message() },
    },
  }), /duplicate reasoning effort: high/)

  assert.throws(() => new AIService().use({
    id: "invalid-default",
    name: "Invalid Default",
    reasoning: {
      efforts: [{ id: "high", name: "High" }],
      default_effort: "medium",
    },
    runtime: {
      actions: { text: async () => create_message() },
    },
  }), /unknown default reasoning effort: medium/)

  assert.throws(() => new AIService().use({
    id: "empty-default",
    name: "Empty Default",
    reasoning: {
      efforts: [{ id: "high", name: "High" }],
      default_effort: "",
    },
    runtime: {
      actions: { text: async () => create_message() },
    },
  }), /default reasoning effort must not be empty/)
})

test("AIService exposes reasoning capability and resolves request or default effort", async () => {
  const ai = new AIService()
  ai.use({
    id: "reasoning-model",
    name: "Reasoning Model",
    reasoning: {
      efforts: [
        { id: "low", name: "Low" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      default_effort: "low",
    },
    runtime: {
      actions: {
        text: async (ctx) => create_message({
          reasoning: read_resolved_reasoning(ctx),
          input_effort: ctx.input.reasoning_effort,
          metering: ctx.metering?.metadata,
        }),
      },
    },
  })

  const catalog = AIService.listModels(ai, {
    env: () => undefined,
    identity: "user",
  })
  assert.deepEqual(catalog[0].reasoning, {
    efforts: [
      { id: "low", name: "Low" },
      { id: "high", name: "High", description: "Deep reasoning" },
    ],
    default_effort: "low",
  })

  const action = ai.get("text")
  assert.ok(action)

  const explicit = await action.run(create_context({
    model: "reasoning-model",
    prompt: "hello",
    reasoning_effort: "high",
  }))
  assert.deepEqual(explicit.metadata.reasoning, { effort: "high", source: "request" })
  assert.equal(explicit.metadata.input_effort, "high")
  assert.equal(explicit.metadata.metering.reasoning_effort, "high")

  const fallback_default = await action.run(create_context({
    model: "reasoning-model",
    prompt: "hello",
  }))
  assert.deepEqual(fallback_default.metadata.reasoning, { effort: "low", source: "default" })
  assert.equal(fallback_default.metadata.input_effort, "low")
})

test("AIService rejects unsupported reasoning input against the final fallback model", async () => {
  const ai = new AIService()
  ai.use({
    id: "media-model",
    name: "Media Model",
    reasoning: { efforts: [{ id: "low", name: "Low" }] },
    runtime: {
      actions: { text: async () => create_message() },
    },
  })
  ai.use({
    id: "source-model",
    name: "Source Model",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
    fallback: [{
      match: (media) => media.media_type.startsWith("image/"),
      model_id: "media-model",
    }],
    runtime: {
      actions: { text: async () => create_message() },
    },
  })

  const action = ai.get("text")
  assert.ok(action)
  await assert.rejects(() => action.run(create_context({
    model: "source-model",
    reasoning_effort: "high",
    messages: [{
      id: "user_1",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "https://example.com/a.png" }],
    }],
  })), /Model media-model does not support reasoning_effort: high/)
})

test("AIService rejects reasoning for unsupported models and rejects effort_id aliases", async () => {
  const ai = new AIService()
  ai.use({
    id: "plain-model",
    name: "Plain Model",
    runtime: {
      actions: { text: async () => create_message() },
    },
  })

  const action = ai.get("text")
  assert.ok(action)
  await assert.rejects(() => action.run(create_context({
    model: "plain-model",
    reasoning_effort: "high",
  })), /Model plain-model does not support reasoning_effort/)
  await assert.rejects(() => action.run(create_context({
    model: "plain-model",
    effort_id: "high",
  })), /effort_id is not supported; use reasoning_effort/)
})

test("AIChannel merges defaults, model overrides, and validated reasoning in order", async () => {
  let received_provider_options
  const language_model = new MockLanguageModelV3({
    provider: "openai.chat",
    modelId: "gpt-reasoning",
    doStream: async (options) => {
      received_provider_options = options.providerOptions
      return create_text_stream()
    },
  })

  class OpenAIReasoningChannel extends AIChannel {
    async stream(input) {
      return language_model.doStream(input.call)
    }
  }

  const provider_options = {
    openai: {
      store: true,
      reasoningEffort: "provider-default",
      serviceTier: "default",
    },
    custom: {
      source: "provider",
      nested: { value: "provider-snapshot" },
    },
  }
  const model_provider_options = {
    openai: {
      store: false,
      reasoningEffort: "model-override",
      serviceTier: "priority",
    },
    custom: { source: "model", enabled: true },
  }
  const provider = new OpenAIReasoningChannel({
    id: "openai",
    ai_sdk_provider_id: "openai",
    ai_sdk_provider_options: provider_options,
  })
  const ai = new AIService()
  ai.use(provider.model({
    id: "gpt-reasoning",
    upstream_model: "gpt-reasoning",
    name: "GPT Reasoning",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
    ai_sdk_provider_options: model_provider_options,
  }))

  provider_options.openai.store = false
  provider_options.custom.nested.value = "mutated"
  model_provider_options.openai.store = true

  const action = ai.get("text")
  assert.ok(action)
  await action.run(create_context({
    model: "gpt-reasoning",
    prompt: "hello",
    reasoning_effort: "high",
  }))
  assert.deepEqual(received_provider_options, {
    openai: {
      store: false,
      reasoningEffort: "high",
      serviceTier: "priority",
    },
    custom: {
      source: "model",
      enabled: true,
      nested: { value: "provider-snapshot" },
    },
  })
  const catalog = AIService.listModels(ai, {
    env: () => undefined,
    identity: "user",
  })
  assert.equal("provider_options" in catalog[0], false)
})

test("AIChannel default text action passes reasoning providerOptions into AI SDK", async () => {
  let received_provider_options
  const language_model = new MockLanguageModelV3({
    provider: "openai.chat",
    modelId: "gpt-reasoning",
    doStream: async (options) => {
      received_provider_options = options.providerOptions
      return create_text_stream()
    },
  })

  class DefaultTextChannel extends AIChannel {
    constructor() {
      super({
        id: "openai",
        env_key: "OPENAI_API_KEY",
        ai_sdk_provider_id: "openai",
      })
    }

    async stream(input) {
      return language_model.doStream(input.call)
    }
  }

  const ai = new AIService()
  const provider = new DefaultTextChannel()
  ai.use(provider.model({
    id: "gpt-reasoning",
    upstream_model: "gpt-reasoning",
    name: "GPT Reasoning",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
  }))

  const action = ai.get("text")
  assert.ok(action)
  const output = await action.run(create_context({
    model: "gpt-reasoning",
    prompt: "hello",
    reasoning_effort: "high",
  }, (key) => key === "OPENAI_API_KEY" ? "test-key" : undefined))

  assert.equal(output.parts[0].text, "ok")
  assert.deepEqual(received_provider_options, {
    openai: { reasoningEffort: "high" },
  })
})

test("AIChannel text action adapts tools through the same LanguageModelV3 stream", async () => {
  let received_tools
  const input_schema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  }
  const language_model = new MockLanguageModelV3({
    provider: "openai.responses",
    modelId: "gpt-tools",
    doStream: async (options) => {
      received_tools = options.tools
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "ping",
              input: "{\"value\":\"hello\"}",
            })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 0, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }
    },
  })

  class ToolsChannel extends AIChannel {
    async stream(input) {
      return language_model.doStream(input.call)
    }
  }

  const ai = new AIService()
  const provider = new ToolsChannel({ id: "openai" })
  ai.use(provider.model({ id: "gpt-tools", upstream_model: "gpt-tools", name: "GPT Tools" }))

  const output = await ai.get("text").run(create_context({
    model: "gpt-tools",
    prompt: "run ping",
    tools: [{
      type: "function",
      function: {
        name: "ping",
        description: "Ping",
        parameters: input_schema,
      },
    }],
  }))

  assert.deepEqual(received_tools, [{
    type: "function",
    name: "ping",
    description: "Ping",
    inputSchema: input_schema,
    providerOptions: undefined,
  }])
  assert.deepEqual(output.parts.find((part) => part.type === "dynamic-tool"), {
    type: "dynamic-tool",
    toolCallId: "call_1",
    toolName: "ping",
    state: "input-available",
    input: { value: "hello" },
  })
})

test("AIChannel does not infer store policy from OpenAI Responses model identity", async () => {
  let received_provider_options
  const language_model = new MockLanguageModelV3({
    provider: "openai.responses",
    modelId: "gpt-responses",
    doStream: async (options) => {
      received_provider_options = options.providerOptions
      return create_text_stream()
    },
  })

  class ResponsesChannel extends AIChannel {
    constructor() {
      super({
        id: "openai",
        env_key: "OPENAI_API_KEY",
        ai_sdk_provider_id: "openai",
      })
    }

    async stream(input) {
      return language_model.doStream(input.call)
    }
  }

  const ai = new AIService()
  const provider = new ResponsesChannel()
  ai.use(provider.model({
    id: "gpt-responses",
    upstream_model: "gpt-responses",
    name: "GPT Responses",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
  }))

  const action = ai.get("text")
  assert.ok(action)
  await action.run(create_context({
    model: "gpt-responses",
    prompt: "hello",
    reasoning_effort: "high",
  }, (key) => key === "OPENAI_API_KEY" ? "test-key" : undefined))

  assert.deepEqual(received_provider_options, {
    openai: { reasoningEffort: "high" },
  })
})

test("OpenAI-compatible action receives the validated default reasoning_effort", async () => {
  let received_reasoning
  let received_call
  let received_model
  class OpenAICompatibleChannel extends AIChannel {
    async stream(input) {
      received_reasoning = input.reasoning
      received_call = input.call
      received_model = input.model
      return create_text_stream("hello")
    }
  }

  const ai = new AIService()
  const channel = new OpenAICompatibleChannel({
    id: "openai",
    ai_sdk_provider_id: "openai",
  })
  ai.use(channel.model({
    id: "openai-route-model",
    upstream_model: "upstream-openai-route-model",
    name: "OpenAI Route Model",
    reasoning: {
      efforts: [{ id: "high", name: "High" }],
      default_effort: "high",
    },
  }))

  const action = ai.get("chat/completions")
  assert.ok(action)
  const response = await action.run(create_context({
    model: "openai-route-model",
    messages: [{ role: "user", content: "hello" }],
  }))
  assert.equal(response.status, 200)
  const output = await response.json()
  assert.equal(output.model, "openai-route-model")
  assert.equal(output.choices[0].message.content, "hello")
  assert.deepEqual(received_reasoning, { effort: "high", source: "default" })
  assert.deepEqual(received_model, {
    id: "openai-route-model",
    upstream_model: "upstream-openai-route-model",
  })
  assert.deepEqual(received_call.prompt, [{
    role: "user",
    content: [{ type: "text", text: "hello" }],
  }])
})
