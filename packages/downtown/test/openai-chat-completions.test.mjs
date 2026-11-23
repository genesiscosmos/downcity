/** OpenAI Chat Completions 边界 Adapter 回归测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import { AIChannel, AIService } from "../bin/index.js"

function create_context(input) {
  return { input: { ...input }, locals: {}, db: {}, env: () => undefined }
}

test("OpenAI-compatible tools and SSE use the same Downcity ModelCall", async () => {
  let received_call
  class ToolsChannel extends AIChannel {
    async stream(input) {
      received_call = input.call
      return { stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "model_start", request_id: "req_1", model_id: input.model.id })
          controller.enqueue({ type: "tool_call_start", content_id: "tool_1", tool_call_id: "call_1", tool_name: "weather" })
          controller.enqueue({ type: "tool_call_delta", content_id: "tool_1", input_delta: "{\"city\":\"Shanghai\"}" })
          controller.enqueue({ type: "tool_call_finish", content_id: "tool_1", input: { city: "Shanghai" } })
          controller.enqueue({ type: "model_usage", usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, cached_input_tokens: 4 } })
          controller.enqueue({ type: "model_finish", finish_reason: "tool_call" })
          controller.close()
        },
      }) }
    }
  }
  const ai = new AIService()
  const channel = new ToolsChannel({ id: "tools" })
  ai.use(channel.model({ id: "tools-model", upstream_model: "vendor-tools-model", name: "Tools" }))
  const response = await ai.get("chat/completions").run(create_context({
    model: "tools-model", stream: true,
    messages: [{ role: "user", content: "weather?" }],
    tools: [{ type: "function", function: {
      name: "weather", description: "Read weather",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    } }],
    tool_choice: { type: "function", function: { name: "weather" } },
  }))

  assert.deepEqual(received_call.messages, [{ role: "user", content: [{ type: "text", text: "weather?" }] }])
  assert.deepEqual(received_call.tools[0], {
    name: "weather", description: "Read weather",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  })
  assert.deepEqual(received_call.tool_choice, { type: "tool", tool_name: "weather" })
  const sse = await response.text()
  assert.match(sse, /"name":"weather"/)
  assert.match(sse, /Shanghai/)
  assert.match(sse, /"finish_reason":"tool_calls"/)
  assert.match(sse, /"cached_tokens":4/)
  assert.match(sse, /data: \[DONE\]/)
})
