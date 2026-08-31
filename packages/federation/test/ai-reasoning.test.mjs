/** AIService reasoning 与最终模型解析回归测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import { AIChannel, AIService } from "../bin/index.js"

function create_context(input, env = () => undefined) {
  return { input: { ...input }, locals: {}, db: {}, env }
}

function create_stream(model_id = "model") {
  return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "model_start", request_id: "req_1", model_id })
    controller.enqueue({ type: "text_start", content_id: "text_1" })
    controller.enqueue({ type: "text_delta", content_id: "text_1", delta: "ok" })
    controller.enqueue({ type: "text_finish", content_id: "text_1" })
    controller.enqueue({ type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
    controller.enqueue({ type: "model_finish", finish_reason: "stop" })
    controller.close()
  } }) }
}

test("AIService validates and exposes reasoning configuration", () => {
  const ai = new AIService()
  assert.throws(() => ai.use({
    id: "invalid", name: "Invalid",
    reasoning: { efforts: [{ id: "high", name: "High" }, { id: "high", name: "Duplicate" }] },
    runtime: { actions: {} },
  }), /duplicate reasoning effort: high/)

  class Channel extends AIChannel { async stream(input) { return create_stream(input.model.id) } }
  const channel = new Channel({ id: "reasoning" })
  ai.use(channel.model({
    id: "reasoning-model", upstream_model: "vendor", name: "Reasoning",
    reasoning: {
      efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
      default_effort: "low",
    },
  }))
  assert.deepEqual(AIService.listModels(ai, { env: () => undefined, identity: "user" })[0].reasoning, {
    efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
    default_effort: "low",
  })
})

test("OpenAI-compatible request passes validated default reasoning to final Channel", async () => {
  let received_reasoning
  let received_call
  class Channel extends AIChannel {
    async stream(input) {
      received_reasoning = input.reasoning
      received_call = input.call
      return create_stream(input.model.id)
    }
  }
  const ai = new AIService()
  const channel = new Channel({ id: "reasoning" })
  ai.use(channel.model({
    id: "reasoning-model", upstream_model: "vendor", name: "Reasoning",
    reasoning: { efforts: [{ id: "high", name: "High" }], default_effort: "high" },
  }))
  const response = await ai.get("chat/completions").run(create_context({
    model: "reasoning-model", messages: [{ role: "user", content: "hello" }],
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(received_reasoning, { effort: "high", source: "default" })
  assert.deepEqual(received_call.messages, [{ role: "user", content: [{ type: "text", text: "hello" }] }])
})

test("reasoning is validated against the media fallback target", async () => {
  class Channel extends AIChannel { async stream(input) { return create_stream(input.model.id) } }
  const ai = new AIService()
  const channel = new Channel({ id: "routing" })
  ai.use(channel.model({
    id: "media", upstream_model: "media", name: "Media",
    reasoning: { efforts: [{ id: "low", name: "Low" }] },
  }))
  ai.use(channel.model({
    id: "source", upstream_model: "source", name: "Source",
    reasoning: { efforts: [{ id: "high", name: "High" }] },
    fallback: [{ match: (file) => file.media_type.startsWith("image/"), model_id: "media" }],
  }))
  const response = await ai.get("chat/completions").run(create_context({
    model: "source", reasoning_effort: "high",
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }],
  }))
  assert.equal(response.status, 422)
  assert.match(JSON.stringify(await response.json()), /media does not support reasoning_effort: high/)
})
