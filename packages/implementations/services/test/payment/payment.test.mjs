/**
 * Payment 订单生命周期、持久化事件队列与 Credits 入账集成测试。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/federation"
import { CreditsService, PaymentService } from "../../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"
import { create_test_admin_session } from "../admin-fixture.mjs"

test("PaymentService owns orders and tops up Credits after paid webhook", async () => {
  const cwd = process.cwd()
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-payment-"))
  try {
    process.chdir(temp_dir)
    const federation = new Federation({ database: createSqliteDb(path.join(temp_dir, "test.sqlite")) })
    const queued_messages = []
    federation.queue.use({ send: async (message) => { queued_messages.push(message) } })
    const drain_queue = async () => {
      while (queued_messages.length) await federation.queue.call(queued_messages.shift())
    }
    const credits = new CreditsService()
    const provider = create_test_provider()
    let resolved_topup
    let resolve_topup_count = 0
    let fail_on_paid_once = false
    const payment = new PaymentService({
      resolve_topup: (input) => {
        resolve_topup_count += 1
        resolved_topup = input
        return { credits: input.topup_amount_minor * 10 }
      },
      providers: [provider],
      on_paid: async (record) => {
        if (fail_on_paid_once) {
          fail_on_paid_once = false
          throw new Error("temporary credits failure")
        }
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

    const admin_secret = await create_test_admin_session(federation)
    const city = await (await federation.fetch(admin_request(admin_secret, "/v1/bureaus/create", {
      name: "Test",
      server_url: "https://bureau.example.com",
    }))).json()
    const token = await (await federation.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })
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
    })
    const checkout = await (await federation.fetch(request)).json()
    const duplicate = await (await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 99,
      idempotency_key: "checkout:1",
      note: "购买 500 Credits",
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

    const webhook = (body) => new Request("http://localhost/v1/payment/webhook?provider=test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const provider_payment_id = "provider_payment_same"
    const processing_response = await federation.fetch(webhook({
      event_id: "event_processing_1",
      type: "payment.processing",
      status: "ignored",
      payment_id: checkout.payment_id,
      provider_payment_id,
    }))
    assert.equal(processing_response.status, 200)
    assert.equal((await processing_response.json()).sync_status, "pending")
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 0)

    const succeeded_event = {
      event_id: "event_succeeded_1",
      type: "payment.succeeded",
      status: "paid",
      payment_id: checkout.payment_id,
      provider_payment_id,
      amount_minor: 99,
      currency: "usd",
    }
    const accepted_paid = await federation.fetch(webhook(succeeded_event))
    assert.equal(accepted_paid.status, 200)
    assert.equal((await accepted_paid.json()).sync_status, "pending")
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 0)
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)
    assert.equal((await federation.fetch(webhook(succeeded_event))).status, 200)
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)

    const events_response = await federation.fetch(new Request("http://localhost/v1/payment/events", {
      headers: { authorization: `Bearer ${admin_secret}` },
    }))
    const event_records = (await events_response.json()).items
    assert.equal(event_records.length, 2)
    assert.deepEqual(
      event_records.map((item) => [item.event_id, item.sync_status]).sort(),
      [
        ["test:event_processing_1", "ignored"],
        ["test:event_succeeded_1", "applied"],
      ],
    )

    const late_failed_response = await federation.fetch(webhook({
      event_id: "event_failed_after_paid",
      type: "payment.failed",
      status: "failed",
      payment_id: checkout.payment_id,
      provider_payment_id,
    }))
    assert.equal((await late_failed_response.json()).sync_status, "pending")
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)

    const recovery_checkout = await (await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 10,
      idempotency_key: "checkout:recovery",
    }))).json()
    const failed_before_paid = await federation.fetch(webhook({
      event_id: "event_failed_before_paid",
      type: "payment.failed",
      status: "failed",
      payment_id: recovery_checkout.payment_id,
    }))
    assert.equal((await failed_before_paid.json()).sync_status, "pending")
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 990)
    const recovered_paid = await federation.fetch(webhook({
      event_id: "event_recovered_paid",
      type: "payment.succeeded",
      status: "paid",
      payment_id: recovery_checkout.payment_id,
      provider_payment_id: "provider_recovery",
      amount_minor: 10,
      currency: "usd",
    }))
    assert.equal((await recovered_paid.json()).sync_status, "pending")
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 1_090)

    const retry_checkout = await (await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test",
      topup_amount_minor: 5,
      idempotency_key: "checkout:on-paid-retry",
    }))).json()
    const retry_event = {
      event_id: "event_on_paid_retry",
      type: "payment.succeeded",
      status: "paid",
      payment_id: retry_checkout.payment_id,
      provider_payment_id: "provider_retry",
      amount_minor: 5,
      currency: "usd",
      delivery: 1,
    }
    fail_on_paid_once = true
    const first_retry_response = await federation.fetch(webhook(retry_event))
    assert.equal(first_retry_response.status, 200)
    assert.equal((await first_retry_response.json()).sync_status, "pending")
    await assert.rejects(drain_queue(), /temporary credits failure/u)
    const inbox_response = await federation.fetch(new Request("http://localhost/v1/payment/events/inbox", {
      headers: { authorization: `Bearer ${admin_secret}` },
    }))
    const retry_record = (await inbox_response.json()).items.find((item) => item.event_id === "test:event_on_paid_retry")
    assert.equal(retry_record.status, "pending")
    assert.equal(retry_record.last_error, "payment_processing_failed")
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 1_090)

    const recovered_retry_response = await federation.fetch(webhook({ ...retry_event, delivery: 2 }))
    assert.equal(recovered_retry_response.status, 200)
    assert.equal((await recovered_retry_response.json()).sync_status, "pending")
    // 管理员重放重置持久化退避，无需真实等待重试时间。
    const replay_response = await federation.fetch(admin_request(admin_secret, "/v1/payment/events/replay", {
      event_id: "test:event_on_paid_retry",
    }))
    assert.equal(replay_response.status, 200)
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 1_140)

    const payments_response = await federation.fetch(new Request("http://localhost/v1/payment/payments", {
      headers: { authorization: `Bearer ${admin_secret}` },
    }))
    const payment_records = (await payments_response.json()).items
    assert.equal(payment_records.every((item) => item.status === "paid"), true)

    const guarded_checkout = await (await federation.fetch(user_request(token.user_token, "/v1/payment/checkout/create", {
      method_id: "test", topup_amount_minor: 20, idempotency_key: "checkout:guarded",
    }))).json()
    await federation.fetch(webhook({ event_id: "event_wrong_amount", payment_id: guarded_checkout.payment_id,
      provider_payment_id: "provider_guarded", status: "paid", amount_minor: 1, currency: "usd" }))
    await assert.rejects(drain_queue(), /does not match order/u)
    assert.equal((await credits.read_account("user_1")).available_credits, 1_140)
    const inbox_table = await federation.table("payment.inbox")
    const mismatch = (await inbox_table.select({ event_id: "test:event_wrong_amount" }))[0]
    assert.equal(mismatch.status, "review")

    await federation.fetch(webhook({ event_id: "event_lost_delivery", payment_id: guarded_checkout.payment_id,
      provider_payment_id: "provider_guarded", status: "paid", amount_minor: 20, currency: "usd" }))
    // 模拟队列消息丢失及旧执行租约过期，恢复必须无需 Provider 再投递。
    queued_messages.length = 0
    await inbox_table.update({ where: { event_id: "test:event_lost_delivery" },
      values: { status: "processing", lease: "interrupted", lease_until: 0 } })
    assert.equal((await payment.recover_events()).scheduled, 1)
    await drain_queue()
    assert.equal((await credits.read_account("user_1")).available_credits, 1_340)
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
        type: body.type ?? "payment.succeeded",
        payload: body,
        status: body.status ?? "paid",
        payment_id: body.payment_id,
        provider_payment_id: body.provider_payment_id,
        amount_minor: body.amount_minor,
        currency: body.currency,
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
