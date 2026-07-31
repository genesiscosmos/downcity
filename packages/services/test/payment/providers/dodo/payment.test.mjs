/** Dodo Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { dodoPaymentProvider } from "../../../../bin/index.js"

test("Dodo provider maps paid webhook to a Payment order", async () => {
  const webhook_key_bytes = Buffer.from("dodo webhook test secret")
  const webhook_key = `whsec_${webhook_key_bytes.toString("base64")}`
  const provider = dodoPaymentProvider({ webhook_key })
  const event = await provider.parseWebhook(webhook_input({
    type: "payment.succeeded",
    data: { payment_id: "provider_pay_1", metadata: { payment_id: "pay_1" } },
  }, webhook_key_bytes, { webhook_id: "webhook_paid_1" }))
  assert.equal(event.event_id, "webhook_paid_1")
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_payment_id, "provider_pay_1")
  assert.equal(event.meta.dodo_webhook_id, "webhook_paid_1")
})

test("Dodo provider identifies lifecycle events by webhook-id instead of payment id", async () => {
  const webhook_key_bytes = Buffer.from("dodo webhook test secret")
  const webhook_key = `whsec_${webhook_key_bytes.toString("base64")}`
  const provider = dodoPaymentProvider({ webhook_key })
  const payment = {
    payment_id: "provider_pay_same",
    checkout_session_id: "checkout_same",
    metadata: { payment_id: "pay_same" },
  }
  const processing = await provider.parseWebhook(webhook_input({
    type: "payment.processing",
    data: payment,
  }, webhook_key_bytes, { webhook_id: "webhook_processing_1" }))
  const succeeded = await provider.parseWebhook(webhook_input({
    type: "payment.succeeded",
    data: payment,
  }, webhook_key_bytes, { webhook_id: "webhook_succeeded_1" }))

  assert.equal(processing.event_id, "webhook_processing_1")
  assert.equal(processing.status, "ignored")
  assert.equal(succeeded.event_id, "webhook_succeeded_1")
  assert.equal(succeeded.status, "paid")
  assert.equal(processing.provider_payment_id, succeeded.provider_payment_id)
})

test("Dodo provider rejects a webhook without the required webhook-id", async () => {
  const webhook_key_bytes = Buffer.from("dodo webhook test secret")
  const webhook_key = `whsec_${webhook_key_bytes.toString("base64")}`
  const provider = dodoPaymentProvider({ webhook_key })

  await assert.rejects(
    provider.parseWebhook(webhook_input({
      type: "payment.succeeded",
      data: { payment_id: "provider_pay_1", metadata: { payment_id: "pay_1" } },
    }, webhook_key_bytes, { include_webhook_id: false })),
    /Dodo webhook-id header is required/,
  )
})

test("Dodo provider rejects missing webhook configuration", async () => {
  const provider = dodoPaymentProvider({ api_key: "dodo_test", product_id: "prod_test" })
  assert.equal(provider.method({ env: () => undefined }).enabled, false)
  await assert.rejects(provider.parseWebhook(webhook_input({ id: "evt_2" }, Buffer.from("unused"))), /not configured/)
})

test("Dodo provider rejects an invalid webhook signature", async () => {
  const webhook_key_bytes = Buffer.from("dodo webhook test secret")
  const provider = dodoPaymentProvider({ webhook_key: `whsec_${webhook_key_bytes.toString("base64")}` })
  await assert.rejects(
    provider.parseWebhook(webhook_input({ id: "evt_bad" }, Buffer.from("wrong secret"))),
  )
})

function webhook_input(body, webhook_key_bytes, options = {}) {
  const raw = JSON.stringify(body)
  const webhook_id = options.webhook_id ?? "webhook_test"
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac("sha256", webhook_key_bytes)
    .update(`${webhook_id}.${timestamp}.${raw}`)
    .digest("base64")
  const headers = {
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  }
  if (options.include_webhook_id !== false) headers["webhook-id"] = webhook_id
  return {
    raw,
    request: new Request("http://localhost/webhook", {
      method: "POST",
      body: raw,
      headers,
    }),
    ctx: { env: () => undefined },
  }
}
