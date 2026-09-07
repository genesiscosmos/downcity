/** OpenAI-compatible Provider Adapter 双向转换测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import { create_openai_compatible_model } from "../bin/index.js"

test("Provider Adapter maps ModelCall and arbitrarily split SSE into Downcity events", async () => {
  let upstream_request
  const encoder = new TextEncoder()
  const payload = [
    { choices: [{ delta: { content: "hel" }, finish_reason: null }] },
    { choices: [{ delta: { content: "lo", tool_calls: [{ index: 0, id: "call_1", function: { name: "pi", arguments: "{\"value\":" } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "ng", arguments: "1}" } }] }, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n"
  const model = create_openai_compatible_model({
    id: "local-model", upstream_model: "vendor-model",
    base_url: "https://provider.example/v1", api_key: "secret",
    fetch: async (_url, init) => {
      upstream_request = JSON.parse(init.body)
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(payload.slice(0, 17)))
          controller.enqueue(encoder.encode(payload.slice(17, 91)))
          controller.enqueue(encoder.encode(payload.slice(91)))
          controller.close()
        },
      }), { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_upstream" } })
    },
  })
  const events = []
  for await (const event of await model.stream({
    messages: [{ role: "user", content: [
      { type: "text", text: "hello" },
      { type: "file", media_type: "image/png", source: { type: "base64", data: "YWJj" } },
    ] }],
    tools: [{ name: "ping", description: "Ping", input_schema: { type: "object" } }],
  })) events.push(event)

  assert.equal(upstream_request.model, "vendor-model")
  assert.equal(upstream_request.messages[0].content[1].image_url.url, "data:image/png;base64,YWJj")
  assert.equal(upstream_request.tools[0].function.name, "ping")
  assert.deepEqual(events.find((event) => event.type === "tool_call_finish").input, { value: 1 })
  assert.deepEqual(events.find((event) => event.type === "model_usage").usage, {
    input_tokens: 4, output_tokens: 2, total_tokens: 6,
  })
  assert.equal(events.at(-1).finish_reason, "tool_call")
})

test("Provider Adapter returns malformed tool arguments as a failed tool input", async () => {
  const encoder = new TextEncoder()
  const payload = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: "{\"content\":\"partial" } }] }, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n"
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    }), { status: 200 }),
  })

  const events = []
  for await (const event of await model.stream({
    messages: [{ role: "user", content: [{ type: "text", text: "write" }] }],
    tools: [{ name: "write", description: "Write", input_schema: { type: "object" } }],
  })) events.push(event)

  const finish = events.find((event) => event.type === "tool_call_finish")
  assert.deepEqual(finish.input, {})
  assert.match(finish.input_error, /invalid JSON.*Unterminated/i)
  assert.equal(events.at(-1).type, "model_finish")
})

test("Provider Adapter classifies an incomplete trailing SSE event as transport failure", async () => {
  const encoder = new TextEncoder()
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial'))
        controller.close()
      },
    }), { status: 200, headers: { "x-request-id": "req_incomplete" } }),
  })

  const events = []
  for await (const event of await model.stream({
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  })) events.push(event)

  const error = events.at(-1).error
  assert.equal(error.code, "transport_error")
  assert.equal(error.retryable, true)
  assert.equal(error.provider_request_id, "req_incomplete")
  assert.equal(error.message, "Model provider stream ended with an incomplete SSE event")
})

test("Provider Adapter classifies a complete invalid SSE JSON event as provider failure", async () => {
  const encoder = new TextEncoder()
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid}\n\n"))
        controller.close()
      },
    }), { status: 200 }),
  })

  const events = []
  for await (const event of await model.stream({
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  })) events.push(event)

  const error = events.at(-1).error
  assert.equal(error.code, "provider_error")
  assert.equal(error.retryable, false)
  assert.equal(error.message, "Model provider returned an invalid SSE JSON event")
})

test("Provider Adapter normalizes upstream HTTP errors without exposing the body", async () => {
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async () => new Response("private provider trace", {
      status: 503,
      statusText: "Service Unavailable",
    }),
  })
  await assert.rejects(
    model.stream({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
    (error) => error.message === "Service Unavailable" && error.statusCode === 503,
  )
})

test("Provider Adapter forwards cancellation to the upstream request", async () => {
  let upstream_signal
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async (_url, init) => {
      upstream_signal = init.signal
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
      })
    },
  })
  const controller = new AbortController()
  const pending = model.stream({
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  }, controller.signal)
  controller.abort(new DOMException("cancelled", "AbortError"))
  await assert.rejects(pending, /cancelled/)
  assert.equal(upstream_signal, controller.signal)
})

test("Provider Adapter reports missing usage as a model_error terminal event", async () => {
  const encoder = new TextEncoder()
  const original_console_error = console.error
  const error_logs = []
  console.error = (...values) => error_logs.push(values)
  const model = create_openai_compatible_model({
    id: "local-model",
    upstream_model: "vendor-model",
    base_url: "https://provider.example/v1",
    api_key: "secret",
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        ))
        controller.close()
      },
    }), { status: 200 }),
  })
  const events = []
  try {
    for await (const event of await model.stream({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    })) events.push(event)
  } finally {
    console.error = original_console_error
  }
  assert.equal(events.at(-1).type, "model_error")
  assert.match(events.at(-1).error.message, /did not return usage/)
  assert.equal(error_logs.length, 1)
  assert.equal(error_logs[0][0], "[OpenAICompatibleModelAdapter] provider did not return usage")
  const diagnostics = JSON.parse(error_logs[0][1])
  assert.equal(diagnostics.model_id, "local-model")
  assert.deepEqual(diagnostics.response_events, [
    JSON.stringify({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }),
    "[DONE]",
  ])
})
