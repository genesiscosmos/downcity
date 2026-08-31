/** AIChannel 显式 Downcity 领域输入回归测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import { AIChannel } from "../bin/index.js"

function create_context(input) {
  return {
    input: { ...input }, locals: {}, db: {},
    env: (key) => key === "UPSTREAM_API_KEY" ? "secret" : undefined,
    user: { user_id: "user_1" }, bureau: { bureau_id: "bureau_1" },
    request: new Request("https://federation.test/v1/ai/stream"),
  }
}

test("AIChannel stream receives only ModelCall and resolved service context", async () => {
  let received_input
  class TestChannel extends AIChannel {
    async stream(input) {
      received_input = input
      return { stream: new ReadableStream({ start(controller) { controller.close() } }) }
    }
  }
  const provider_options = { service_tier: "default", nested: { value: 1 } }
  const model_options = { service_tier: "priority" }
  const channel = new TestChannel({ id: "openai", env_key: "UPSTREAM_API_KEY", provider_options })
  const model = channel.model({
    id: "public-model", upstream_model: "vendor-model", name: "Public Model",
    provider_options: model_options,
  })
  const context = create_context({ model: "public-model" })
  context.locals.ai_reasoning = { effort: "high", source: "request" }
  const call = { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }

  await model.runtime.stream(context, call)

  assert.deepEqual(Object.keys(received_input).sort(), [
    "abort_signal", "call", "env", "model", "provider_options", "reasoning",
  ])
  assert.equal(received_input.call, call)
  assert.deepEqual(received_input.model, { id: "public-model", upstream_model: "vendor-model" })
  assert.equal(received_input.env("UPSTREAM_API_KEY"), "secret")
  assert.deepEqual(received_input.reasoning, { effort: "high", source: "request" })
  assert.deepEqual(received_input.provider_options, { service_tier: "priority", nested: { value: 1 } })
  provider_options.nested.value = 2
  model_options.service_tier = "mutated"
  assert.deepEqual(received_input.provider_options, { service_tier: "priority", nested: { value: 1 } })
})

test("AIChannel action receives a scoped input instead of Federation Context", async () => {
  let received_input
  class TestImageChannel extends AIChannel {
    async image_create(input) {
      received_input = input
      return { job_id: "image_1", status: "running" }
    }
  }
  const channel = new TestImageChannel({ id: "images", env_key: "UPSTREAM_API_KEY" })
  const model = channel.model({ id: "image-model", upstream_model: "vendor-image", name: "Image" })
  const context = create_context({ model: "image-model", prompt: "draw" })
  await model.runtime.actions.image_create(context)

  assert.deepEqual(Object.keys(received_input).sort(), ["bureau_id", "env", "input", "model", "user_id"])
  assert.equal(received_input.input, context.input)
  assert.equal("db" in received_input, false)
  assert.equal("locals" in received_input, false)
})
