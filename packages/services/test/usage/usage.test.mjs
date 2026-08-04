/** UsageService Credits 与 AI Usage 聚合集成测试。 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  AIService,
  Federation,
  create_usage_date_formatter,
  format_usage_local_date,
} from "@downcity/city"
import { create_test_text_model } from "../fixtures/ai-channel.mjs"
import { createSqliteDb } from "./sqlite-db.mjs"
import { CreditsService, UsageService } from "../../bin/index.js"
import { merge_daily_usage } from "../../bin/usage/aggregation.js"

test("UsageService merges applied Credits and final AI usage by local day", async () => {
  const cwd = process.cwd()
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-usage-service-"))

  try {
    process.chdir(temp_dir)
    const database = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const federation = new Federation({ database })
    const credits_service = new CreditsService()
    const ai_service = new AIService({ credits: credits_service })
    ai_service.use(create_test_text_model({
      id: "gpt-5.4",
      name: "GPT-5.4",
      bill: () => ({ credits: 25, note: "test usage" }),
    }))
    ai_service.use(create_test_text_model({
      id: "gpt-failed",
      name: "GPT Failed",
      fail: true,
    }))
    federation.use(credits_service)
    federation.use(ai_service)
    federation.use(new UsageService({
      ai_usage_reader: ai_service,
      credits_usage_reader: credits_service,
    }))

    await federation.health()
    const admin_secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const bureau = await (await federation.fetch(admin_request(admin_secret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()
    const token = await (await federation.getAuthenticator()).createToken({
      bureau_id: bureau.bureau_id,
      user_id: "user_1",
    })
    const other_user_token = await (await federation.getAuthenticator()).createToken({
      bureau_id: bureau.bureau_id,
      user_id: "user_2",
    })
    await credits_service.topup({
      card: { kind: "primary", user_id: "user_1" },
      credits: 100,
      source: "test",
      idempotency_key: "test:topup",
    })
    await credits_service.topup({
      card: { kind: "primary", user_id: "user_2" },
      credits: 50,
      source: "test",
      idempotency_key: "test:topup:user_2",
    })

    const invoke_response = await federation.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.user_token}`,
      },
      body: JSON.stringify({ model: "gpt-5.4", prompt: "hi" }),
    }))
    assert.equal(invoke_response.status, 200)

    const today = new Date().toISOString().slice(0, 10)
    const usage_response = await federation.fetch(new Request(
      `http://localhost/v1/usage/me?from=${today}&to=${today}&timezone=UTC`,
      { headers: { authorization: `Bearer ${token.user_token}` } },
    ))
    assert.equal(usage_response.status, 200)
    const usage = await usage_response.json()
    assert.equal(usage.credits_per_usd, 1_000_000)
    assert.equal(usage.summary.credits.used, 25)
    assert.equal(usage.summary.credits.charge_count, 1)
    assert.equal(usage.summary.ai.execution_count, 1)
    assert.equal(usage.summary.ai.metered_request_count, 1)
    assert.equal(usage.summary.ai.input_tokens, 1)
    assert.equal(usage.summary.ai.output_tokens, 1)
    assert.equal(usage.summary.ai.total_tokens, 2)
    assert.equal(usage.days.length, 1)
    assert.equal(usage.days[0].date, today)

    for (const model of ["gpt-5.4", "gpt-5.4"]) {
      assert.equal(await invoke_ai(federation, token.user_token, model), 200, model)
    }
    assert.equal(await invoke_ai(federation, token.user_token, "gpt-failed"), 500)
    assert.equal(await invoke_ai(federation, other_user_token.user_token, "gpt-5.4"), 200)

    const recent_response = await get_recent_usage(federation, token.user_token, "limit=20")
    assert.equal(recent_response.status, 200)
    const recent = await recent_response.json()
    assert.equal(recent.items.length, 4)
    assert.equal(recent.next_cursor, null)
    assert.deepEqual(Object.keys(recent.items[0]).sort(), [
      "action_id",
      "cached_input_tokens",
      "completed_at",
      "input_tokens",
      "metering_status",
      "model_id",
      "outcome",
      "output_tokens",
      "reasoning_tokens",
      "total_tokens",
      "uncached_input_tokens",
      "usage_id",
    ])
    for (let index = 1; index < recent.items.length; index += 1) {
      const previous = recent.items[index - 1]
      const current = recent.items[index]
      assert.ok(
        previous.completed_at > current.completed_at
        || (previous.completed_at === current.completed_at && previous.usage_id > current.usage_id),
      )
    }
    const unavailable = recent.items.find((item) => item.metering_status === "unavailable")
    assert.ok(unavailable)
    assert.equal(unavailable.input_tokens, null)
    assert.equal(unavailable.total_tokens, null)
    const settled = recent.items.find((item) => item.metering_status === "settled")
    assert.ok(settled)
    assert.equal(settled.uncached_input_tokens, 1)
    assert.equal(settled.cached_input_tokens, 0)
    assert.equal(settled.input_tokens, 1)
    assert.equal(settled.output_tokens, 1)
    assert.equal(settled.reasoning_tokens, 0)
    assert.equal(settled.total_tokens, 2)

    const first_page_response = await get_recent_usage(federation, token.user_token, "limit=2")
    assert.equal(first_page_response.status, 200)
    const first_page = await first_page_response.json()
    assert.equal(first_page.items.length, 2)
    assert.equal(typeof first_page.next_cursor, "string")
    const second_page_response = await get_recent_usage(
      federation,
      token.user_token,
      `limit=2&cursor=${encodeURIComponent(first_page.next_cursor)}`,
    )
    assert.equal(second_page_response.status, 200)
    const second_page = await second_page_response.json()
    assert.equal(second_page.items.length, 2)
    assert.equal(second_page.next_cursor, null)
    assert.deepEqual(
      [...first_page.items, ...second_page.items].map((item) => item.usage_id),
      recent.items.map((item) => item.usage_id),
    )

    const other_user_response = await get_recent_usage(federation, other_user_token.user_token, "")
    assert.equal(other_user_response.status, 200)
    const other_user_recent = await other_user_response.json()
    assert.equal(other_user_recent.items.length, 1)
    assert.ok(!recent.items.some((item) => item.usage_id === other_user_recent.items[0].usage_id))

    for (const query of ["limit=0", "limit=51", "limit=1.5", "cursor=invalid"]) {
      const invalid_recent_response = await get_recent_usage(federation, token.user_token, query)
      assert.equal(invalid_recent_response.status, 400)
    }
    const unauthorized_recent_response = await federation.fetch(
      new Request("http://localhost/v1/usage/me/recent"),
    )
    assert.equal(unauthorized_recent_response.status, 401)

    for (const query of [
      "from=2026-02-30&to=2026-03-01&timezone=UTC",
      "from=2026-03-02&to=2026-03-01&timezone=UTC",
      "from=2025-01-01&to=2026-02-05&timezone=UTC",
      "from=2026-03-01&to=2026-03-01&timezone=Invalid%2FZone",
      "from=2026-03-01&to=2026-03-01",
    ]) {
      const invalid_response = await federation.fetch(new Request(
        `http://localhost/v1/usage/me?${query}`,
        { headers: { authorization: `Bearer ${token.user_token}` } },
      ))
      assert.equal(invalid_response.status, 400)
    }

    const removed_events = await federation.fetch(admin_request(admin_secret, {
      path: "/v1/usage/events",
      method: "GET",
    }))
    assert.equal(removed_events.status, 404)
  } finally {
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

test("UsageService keeps sparse dates and fills the missing fact side with zero values", () => {
  const usage = merge_daily_usage({
    timezone: "America/Los_Angeles",
    from: "2026-03-08",
    to: "2026-03-09",
    credits_per_usd: 1_000_000,
    ai: {
      data_available_from: "2026-03-08",
      days: [{
        date: "2026-03-08",
        execution_count: 1,
        metered_request_count: 1,
        uncached_input_tokens: 2,
        cached_input_tokens: 3,
        input_tokens: 5,
        output_tokens: 7,
        reasoning_tokens: 1,
        total_tokens: 12,
        image_count: 0,
        video_seconds: 0,
        audio_seconds: 0,
      }],
    },
    credits: {
      data_available_from: "2026-03-09",
      days: [{ date: "2026-03-09", used: 25, charge_count: 1 }],
    },
  })

  assert.deepEqual(usage.days.map((day) => day.date), ["2026-03-08", "2026-03-09"])
  assert.deepEqual(usage.days[0].credits, { used: 0, charge_count: 0 })
  assert.equal(usage.days[1].ai.execution_count, 0)
  assert.equal(usage.summary.credits.used, 25)
  assert.equal(usage.summary.ai.total_tokens, 12)
})

test("Usage local dates stay stable across daylight-saving transitions", () => {
  const formatter = create_usage_date_formatter("America/Los_Angeles")

  assert.equal(format_usage_local_date(formatter, "2026-03-08T07:59:59.000Z"), "2026-03-07")
  assert.equal(format_usage_local_date(formatter, "2026-03-08T08:00:00.000Z"), "2026-03-08")
  assert.equal(format_usage_local_date(formatter, "2026-03-08T10:01:00.000Z"), "2026-03-08")
  assert.equal(format_usage_local_date(formatter, "2026-11-01T09:01:00.000Z"), "2026-11-01")
})

function admin_request(admin_secret, { path: pathname, method = "POST", body }) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${admin_secret}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function read_env_value(federation, key) {
  const env_table = await federation.table("env")
  const rows = await env_table.select({ key })
  return rows[0]?.value ?? ""
}

async function invoke_ai(federation, user_token, model) {
  const response = await federation.fetch(new Request("http://localhost/v1/ai/text", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${user_token}`,
    },
    body: JSON.stringify({ model, prompt: "hi" }),
  }))
  return response.status
}

async function get_recent_usage(federation, user_token, query) {
  const suffix = query ? `?${query}` : ""
  return await federation.fetch(new Request(`http://localhost/v1/usage/me/recent${suffix}`, {
    headers: { authorization: `Bearer ${user_token}` },
  }))
}
