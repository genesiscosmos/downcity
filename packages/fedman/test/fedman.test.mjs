/** Fedman 纯逻辑格式化函数与同源 API Client 契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import {
  error_message,
  format_compact_number,
  format_duration,
  format_number,
  format_percent,
  format_value,
} from "../src/lib/format.ts"
import { analytics_url, request_json } from "../src/lib/api.ts"

test("格式化函数稳定处理空值、数值和对象", () => {
  assert.equal(format_number(undefined), "0")
  assert.equal(format_number("1234"), Number(1234).toLocaleString())
  assert.equal(format_compact_number(999), Number(999).toLocaleString())
  assert.equal(
    format_compact_number(12_500),
    new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(12_500),
  )
  assert.equal(format_percent(null), "—")
  assert.equal(format_percent(0.125), "12.5%")
  assert.equal(format_duration(undefined), "—")
  assert.equal(format_duration(999.6), "1000ms")
  assert.equal(format_duration(1_500), "1.50s")
  assert.equal(format_value(null), "")
  assert.equal(format_value({ key: "value" }), JSON.stringify({ key: "value" }))
  assert.equal(error_message(new Error("boom")), "boom")
  assert.equal(error_message("bad"), "bad")
})

test("analytics_url 包含范围与浏览器时区", () => {
  const url = analytics_url("overview", "7d")
  assert.match(url, /^\/api\/usage\/overview\?range=7d&timezone=/)
  assert.ok(url.includes(encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")))
})

test("request_json 设置 JSON 请求头并返回成功 JSON", async () => {
  const original_fetch = globalThis.fetch
  try {
    let received
    globalThis.fetch = async (path, init) => {
      received = { path, init }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    assert.deepEqual(await request_json("/api/test", { method: "POST" }), { ok: true })
    assert.equal(received.path, "/api/test")
    assert.equal(received.init.headers["content-type"], "application/json")
  } finally {
    globalThis.fetch = original_fetch
  }
})

test("request_json 将错误响应转换为 Error，并在 401 时发出事件", async () => {
  const original_fetch = globalThis.fetch
  const original_window = globalThis.window
  const events = []
  try {
    globalThis.window = { dispatchEvent: (event) => events.push(event.type) }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "登录已过期" }), {
      status: 401,
      statusText: "Unauthorized",
    })
    await assert.rejects(request_json("/api/private"), /登录已过期/)
    assert.deepEqual(events, ["fedman:unauthorized"])

    globalThis.fetch = async () => new Response("not-json", {
      status: 503,
      statusText: "Unavailable",
    })
    await assert.rejects(request_json("/api/test"), /503 Unavailable/)
  } finally {
    globalThis.fetch = original_fetch
    if (original_window === undefined) delete globalThis.window
    else globalThis.window = original_window
  }
})
