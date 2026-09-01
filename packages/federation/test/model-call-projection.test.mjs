/** AIService 两条语言模型入口的历史媒体执行视图回归测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import { AIChannel, AIService } from "../bin/index.js"
import { MODEL_PROTOCOL_VERSION } from "@downcity/type"

function create_context(input) {
  return { input: { ...input }, locals: {}, db: {}, env: () => undefined }
}

function create_stream(model_id) {
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

function create_ai(received_calls) {
  class Channel extends AIChannel {
    async stream(input) {
      received_calls.push(input.call)
      return create_stream(input.model.id)
    }
  }
  const channel = new Channel({ id: "projection" })
  const ai = new AIService()
  ai.use(channel.model({ id: "media", upstream_model: "media", name: "Media" }))
  ai.use(channel.model({
    id: "text", upstream_model: "text", name: "Text",
    fallback: [{
      match: (file) => file.media_type.startsWith("image/"),
      model_id: "media",
    }],
  }))
  return ai
}

test("native and OpenAI-compatible inputs send historical images as plain file references", async () => {
  const received_calls = []
  const ai = create_ai(received_calls)
  const native_call = { messages: [
    { role: "user", content: [{
      type: "file", media_type: "image/png", filename: "portrait.png",
      source: { type: "url", url: "https://example.com/portrait.png" },
    }] },
    { role: "assistant", content: [{ type: "text", text: "seen" }] },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ] }
  const native_response = await ai.get("stream").run(create_context({
    protocol_version: MODEL_PROTOCOL_VERSION,
    model_id: "text",
    call: native_call,
  }))
  await native_response.text()

  const openai_response = await ai.get("chat/completions").run(create_context({
    model: "text",
    messages: [
      { role: "user", content: [{
        type: "image_url",
        image_url: { url: "https://example.com/history.png" },
      }] },
      { role: "assistant", content: "seen" },
      { role: "user", content: "continue" },
    ],
  }))
  await openai_response.text()

  assert.deepEqual(received_calls[0].messages[0].content, [{ type: "text", text: "portrait.png" }])
  assert.deepEqual(received_calls[1].messages[0].content, [{
    type: "text",
    text: "https://example.com/history.png",
  }])
})
