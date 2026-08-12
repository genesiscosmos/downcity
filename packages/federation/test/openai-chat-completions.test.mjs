/**
 * OpenAI Chat Completions 到 AIChannel.stream 的统一协议回归测试。
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
    env: () => undefined,
  }
}

test("OpenAI-compatible tools and SSE use the same AIChannel stream", async () => {
  let received_call
  let received_model
  class ToolsChannel extends AIChannel {
    async stream(input) {
      received_call = input.call
      received_model = input.model
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({
              type: "tool-input-start",
              id: "call_1",
              toolName: "weather",
            })
            controller.enqueue({
              type: "tool-input-delta",
              id: "call_1",
              delta: "{\"city\":\"Shanghai\"}",
            })
            controller.enqueue({ type: "tool-input-end", id: "call_1" })
            controller.enqueue({
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "weather",
              input: { city: "Shanghai" },
            })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {
                inputTokens: { total: 12, noCache: 8, cacheRead: 4, cacheWrite: 0 },
                outputTokens: { total: 3, text: 0, reasoning: 3 },
              },
            })
            controller.close()
          },
        }),
      }
    }
  }

  const channel = new ToolsChannel({ id: "tools" })
  const ai = new AIService()
  ai.use(channel.model({
    id: "tools-model",
    upstream_model: "vendor-tools-model",
    name: "Tools Model",
  }))

  const action = ai.get("chat/completions")
  assert.ok(action)
  const response = await action.run(create_context({
    model: "tools-model",
    stream: true,
    messages: [{ role: "user", content: "weather?" }],
    tools: [{
      type: "function",
      function: {
        name: "weather",
        description: "Read weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "weather" } },
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(received_call.prompt, [{
    role: "user",
    content: [{ type: "text", text: "weather?" }],
  }])
  assert.deepEqual(received_call.tools, [{
    type: "function",
    name: "weather",
    description: "Read weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  }])
  assert.deepEqual(received_call.toolChoice, { type: "tool", toolName: "weather" })
  assert.deepEqual(received_model, {
    id: "tools-model",
    upstream_model: "vendor-tools-model",
  })

  const sse = await response.text()
  assert.match(sse, /"name":"weather"/)
  assert.match(sse, /\{\\"city\\":\\"Shanghai\\"\}/)
  assert.equal(sse.match(/Shanghai/g)?.length, 1)
  assert.match(sse, /"finish_reason":"tool_calls"/)
  assert.match(sse, /"cached_tokens":4/)
  assert.match(sse, /data: \[DONE\]/)
})
