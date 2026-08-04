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
    await credits_service.topup({
      card: { kind: "primary", user_id: "user_1" },
      credits: 100,
      source: "test",
      idempotency_key: "test:topup",
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
