/** 最新用户消息媒体 fallback 路由回归测试。 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  project_model_call_for_execution,
  resolve_text_routing_plan,
} from "../bin/service/ai/model-routing.js"

const source_action = () => "source"
const image_action = () => "image"
const pdf_action = () => "pdf"

function create_fixture(options = {}) {
  const image = {
    id: "image-model", name: "Image", channel_id: "image", upstream_model: "image",
    runtime: { stream: image_action, actions: {} },
  }
  const pdf = {
    id: "pdf-model", name: "PDF", channel_id: "pdf", upstream_model: "pdf",
    runtime: { stream: pdf_action, actions: {} },
  }
  const source = {
    id: "source-model", name: "Source", channel_id: "source", upstream_model: "source",
    fallback: [
      { match: (file) => file.media_type.startsWith("image/"), model_id: "image-model" },
      { match: (file) => file.media_type === "application/pdf", model_id: "pdf-model" },
    ],
    runtime: { stream: source_action, actions: {} },
  }
  const models = new Map([[source.id, source], [image.id, image], [pdf.id, pdf]])
  return {
    resolved: { model: source, action: source_action },
    adapter: {
      resolve_model: (id) => models.get(id),
      resolve_action: (model) => model.runtime.stream,
      is_available: (model) => options.unavailable !== model.id,
    },
  }
}

const text = (value) => ({ type: "text", text: value })
const file = (media_type, options = {}) => ({
  type: "file", media_type,
  source: options.source ?? { type: "url", url: "https://example.com/input" },
  ...(options.filename ? { filename: options.filename } : {}),
})

function route(messages, options) {
  const fixture = create_fixture(options)
  return resolve_text_routing_plan(fixture.resolved, { messages }, "stream", fixture.adapter)
}

test("latest user media selects the first available matching fallback and metadata", () => {
  const plan = route([
    { role: "user", content: [text("read"), file("image/png"), file("application/pdf")] },
  ])
  assert.equal(plan.resolved.model.id, "image-model")
  assert.deepEqual({
    fallback_from: plan.fallback_from,
    fallback_reason: plan.fallback_reason,
    fallback_media_type: plan.fallback_media_type,
  }, {
    fallback_from: "source-model",
    fallback_reason: "input_requires_media",
    fallback_media_type: "image/png",
  })
})

test("historical media never overrides the latest text-only user intent", () => {
  const cases = [
    [
      { role: "user", content: [file("image/png")] },
      { role: "assistant", content: [text("seen")] },
      { role: "user", content: [text("continue")] },
    ],
    [
      { role: "user", content: [file("image/png")] },
      { role: "tool", content: [{ type: "tool_result", tool_call_id: "1", tool_name: "x", outcome: "succeeded", content: [{ type: "text", text: "ok" }] }] },
      { role: "user", content: [text("continue")] },
      { role: "assistant", content: [text("pending")] },
    ],
    [
      { role: "user", content: [file("image/png")] },
      { role: "user", content: [text("latest")] },
    ],
  ]
  for (const messages of cases) {
    const plan = route(messages)
    assert.equal(plan.resolved.model.id, "source-model")
    assert.equal(plan.fallback_from, undefined)
  }
})

test("trailing assistant/tool messages still use the nearest user message", () => {
  const plan = route([
    { role: "user", content: [file("image/png")] },
    { role: "assistant", content: [text("pending")] },
    { role: "tool", content: [{ type: "tool_result", tool_call_id: "1", tool_name: "x", outcome: "succeeded", content: [{ type: "text", text: "ok" }] }] },
  ])
  assert.equal(plan.resolved.model.id, "image-model")
})

test("assistant/system/tool files and missing users do not trigger fallback", () => {
  for (const messages of [
    [],
    [{ role: "system", content: [text("system")] }],
    [{ role: "assistant", content: [file("image/png")] }],
    [{ role: "tool", content: [{ type: "tool_result", tool_call_id: "1", tool_name: "x", outcome: "succeeded", content: [file("image/png")] }] }],
  ]) {
    assert.equal(route(messages).resolved.model.id, "source-model")
  }
})

test("an unavailable target keeps the source model without fallback metadata", () => {
  const plan = route([{ role: "user", content: [file("image/png")] }], { unavailable: "image-model" })
  assert.equal(plan.resolved.model.id, "source-model")
  assert.equal(plan.fallback_reason, undefined)
})

test("historical matching files degrade to filename or original source for the final text model", () => {
  const fixture = create_fixture()
  const call = {
    messages: [
      { role: "user", content: [
        text("identify"),
        file("image/png", { filename: "portrait.png" }),
        file("application/pdf"),
        file("text/plain", { filename: "notes.txt" }),
      ] },
      { role: "assistant", content: [text("done")] },
      { role: "user", content: [text("continue")] },
    ],
  }

  const projected = project_model_call_for_execution(call, fixture.resolved.model)
  assert.deepEqual(projected.messages[0].content, [
    text("identify"),
    text("portrait.png"),
    text("https://example.com/input"),
    file("text/plain", { filename: "notes.txt" }),
  ])
  assert.equal(call.messages[0].content[1].type, "file")
  assert.equal(projected.messages[2], call.messages[2])
})

test("latest user files are never degraded and base64 history falls back to MIME type", () => {
  const fixture = create_fixture()
  const historical = file("image/png", {
    source: { type: "base64", data: "aW1hZ2U=" },
  })
  const latest = file("image/png", { filename: "latest.png" })
  const call = { messages: [
    { role: "user", content: [historical] },
    { role: "assistant", content: [text("done")] },
    { role: "user", content: [text("again"), latest] },
  ] }

  const projected = project_model_call_for_execution(call, fixture.resolved.model)
  assert.deepEqual(projected.messages[0].content, [text("image/png")])
  assert.equal(projected.messages[2].content[1], latest)
})
