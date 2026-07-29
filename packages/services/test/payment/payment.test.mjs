/**
 * Payment 订单生命周期与 Credits 入账集成测试。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/city"
import { CreditsService, PaymentService } from "../../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

test("PaymentService owns orders and tops up Credits after paid webhook", async () => {
  const cwd = process.cwd()
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-payment-"))
  try {
    process.chdir(temp_dir)
    const federation = new Federation({ db: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    const credits = new CreditsService()
    const provider = create_test_provider()
    let resolved_topup
    let resolve_topup_count = 0
    const payment = new PaymentService({
      resolve_topup: (input) => {
        resolve_topup_count += 1
        resolved_topup = input
        return { credits: input.topup_amount_minor * 10 }
      },
      providers: [provider],
      on_paid: async (record) => {
        await credits.topup({
          card: { kind: "primary", user_id: record.user_id },
          credits: record.credits,
          source: "payment",
          ref: record.payment_id,
          idempotency_key: `payment:${record.payment_id}`,
          note: record.note,
        })
      },
    })
    federation.use(credits)
    federation.use(payment)
    await federation.health()

    const admin_secret = await read_env_value(federation, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")
    const city = await (await federation.fetch(admin_request(admin_secret, "/v1/cities/create", { name: "Test" }))).json()
    const token = await (await federation.fetch(admin_request(admin_secret, "/v1/cities/tokens/apply", {
      city_id: city.city_id,
      user_id: "user_1",
    }))).json()
    const rejected_legacy = await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      credits: 999_999_999,
      amount_minor: 1,
      topup_amount_minor: 1,
      idempotency_key: "checkout:legacy",
    }))
    assert.equal(rejected_legacy.ok, false)
    assert.equal((await credits.read_account("user_1")).available_credits, 0)

    const request = user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 99,
      idempotency_key: "checkout:1",
      note: "购买 500 Credits",
      metadata: { campaign: "summer", nested: { b: 2, a: 1 } },
    })
    const checkout = await (await federation.fetch(request)).json()
    const duplicate = await (await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 99,
      idempotency_key: "checkout:1",
      note: "购买 500 Credits",
      metadata: { nested: { a: 1, b: 2 }, campaign: "summer" },
    }))).json()
    assert.equal(duplicate.payment_id, checkout.payment_id)
    assert.deepEqual(resolved_topup, {
      user_id: "user_1",
      provider: "test",
      currency: "usd",
      topup_amount_minor: 99,
    })
    assert.equal(checkout.credits, 990)
    assert.equal(checkout.topup_amount_minor, 99)
    assert.equal(resolve_topup_count, 1)
    assert.equal(provider.last_payment().payment_id, checkout.payment_id)
    assert.equal(provider.last_payment().amount_minor, 99)
    assert.equal(provider.last_payment().credits, 990)

    const conflicting_note = await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 99,
      idempotency_key: "checkout:1",
      note: "不同说明",
      metadata: { campaign: "summer", nested: { a: 1, b: 2 } },
    }))
    assert.equal(conflicting_note.ok, false)

    const conflicting_metadata = await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 99,
      idempotency_key: "checkout:1",
      note: "购买 500 Credits",
      metadata: { campaign: "winter", nested: { a: 1, b: 2 } },
    }))
    assert.equal(conflicting_metadata.ok, false)
    assert.equal(resolve_topup_count, 1)

    const webhook = () => new Request("http://localhost/v1/payment/webhook?provider=test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: "event_1", payment_id: checkout.payment_id }),
    })
    assert.equal((await federation.fetch(webhook())).status, 200)
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)
    assert.equal((await federation.fetch(webhook())).status, 200)
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)
  } finally {
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})

function create_test_provider() {
  let payment
  return {
    id: "test",
    label: "Test",
    env: [],
    method: () => ({
      id: "test",
      type: "checkout",
      enabled: true,
      label: "Test",
      service: "payment",
      action: "checkout/create",
      requires_user: true,
      currency: "usd",
    }),
    createCheckout: async (input) => {
      payment = input.payment
      return { provider_session_id: "session_1", checkout_url: "https://pay.test/session_1" }
    },
    parseWebhook: async (input) => {
      const body = JSON.parse(input.raw)
      return {
        event_id: body.event_id,
        type: "payment.paid",
        payload: body,
        status: "paid",
        payment_id: body.payment_id,
      }
    },
    last_payment: () => payment,
  }
}

function admin_request(secret, pathname, body) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function user_request(token, pathname, body) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function read_env_value(federation, key) {
  const env_table = await federation.table("env")
  const rows = await env_table.select({ key })
  return rows[0]?.value ?? ""
}
