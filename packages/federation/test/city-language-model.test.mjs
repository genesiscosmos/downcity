/** CityModel 原生 Downcity Model Protocol transport 契约测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  FederationModel as CityModel,
} from "../bin/index.js"
import { MODEL_PROTOCOL_VERSION } from "@downcity/type"
import {
  create_city_language_model_stream,
  decode_city_language_model_request,
  prepare_city_language_model_call,
} from "../bin/service/ai/language-model-stream.js"

const call = {
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  reasoning: { enabled: true, effort: "high" },
}

test("ModelCall transport preserves the Downcity protocol without provider rewriting", () => {
  assert.equal(prepare_city_language_model_call(call), call)
  assert.deepEqual(decode_city_language_model_request({
    protocol_version: MODEL_PROTOCOL_VERSION,
    model_id: "city-model",
    call,
  }), { model_id: "city-model", call })
  assert.throws(() => decode_city_language_model_request({
    protocol_version: 999,
    model_id: "city-model",
    call,
  }), /Unsupported Downcity model protocol/)
})

test("CityModel sends ModelStreamRequest and decodes versioned SSE events", async () => {
  const requests = []
  const events = [
    { type: "model_start", request_id: "req_1", model_id: "city-model" },
    { type: "text_start", content_id: "text_1" },
    { type: "text_delta", content_id: "text_1", delta: "done" },
    { type: "text_finish", content_id: "text_1" },
    { type: "model_usage", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } },
    { type: "model_finish", finish_reason: "stop" },
  ]
  const encoder = new TextEncoder()
  const model = new CityModel({
    descriptor: {
      id: "city-model", name: "City", description: "", modalities: ["stream"], tags: [], meta: {},
    },
    request_stream: async (request, signal) => {
      requests.push({ request, signal })
      return new Response(new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ protocol_version: MODEL_PROTOCOL_VERSION, event })}\n\n`))
          }
          controller.close()
        },
      }), { headers: { "content-type": "text/event-stream" } })
    },
  })
  const abort_controller = new AbortController()
  const output = []
  for await (const event of await model.stream(call, abort_controller.signal)) output.push(event)

  assert.deepEqual(requests[0].request, {
    protocol_version: MODEL_PROTOCOL_VERSION,
    model_id: "city-model",
    call,
  })
  assert.equal(requests[0].signal, abort_controller.signal)
  assert.deepEqual(output, events)
})

test("Federation SSE encoder exposes only versioned ModelStreamEvent envelopes", async () => {
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
  const events = [
    { type: "model_start", request_id: "req_1", model_id: "model" },
    { type: "model_usage", usage },
    { type: "model_finish", finish_reason: "stop" },
  ]
  const execution = create_city_language_model_stream({
    stream: new ReadableStream({ start(controller) {
      for (const event of events) controller.enqueue(event)
      controller.close()
    } }),
  })
  const text = await execution.response.text()
  assert.match(text, /"protocol_version":1/)
  assert.match(text, /"model_finish"/)
  assert.deepEqual(await execution.completion, {
    outcome: "succeeded",
    result: { usage, terminal_event: events[2] },
  })
})

test("Federation rejects invalid ModelStreamEvent state transitions", async () => {
  const cases = [
    [
      { type: "text_delta", content_id: "text_1", delta: "invalid" },
    ],
    [
      { type: "model_start", request_id: "req_1", model_id: "model" },
      { type: "text_finish", content_id: "text_1" },
    ],
    [
      { type: "model_start", request_id: "req_1", model_id: "model" },
      { type: "model_finish", finish_reason: "stop" },
    ],
    [
      { type: "model_start", request_id: "req_1", model_id: "model" },
      { type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      { type: "model_finish", finish_reason: "stop" },
      { type: "text_start", content_id: "late" },
    ],
  ]
  for (const events of cases) {
    const execution = create_city_language_model_stream({
      stream: new ReadableStream({ start(controller) {
        for (const event of events) controller.enqueue(event)
        controller.close()
      } }),
    })
    await execution.response.text()
    assert.equal((await execution.completion).outcome, "failed")
  }
})
