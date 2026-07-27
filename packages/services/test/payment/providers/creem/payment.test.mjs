/** Creem Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { creemPaymentProvider } from "../../../../bin/index.js"

test("Creem provider maps paid webhook to a Payment order", async () => {
  const webhook_secret = "creem_test"
  const provider = creemPaymentProvider({ webhook_secret })
  const event = await provider.parseWebhook(webhook_input({
    id: "evt_1",
    eventType: "checkout.completed",
    object: { id: "checkout_1", order: { id: "order_1" }, metadata: { payment_id: "pay_1" } },
  }, webhook_secret))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_order_id, "order_1")
})

test("Creem provider rejects missing webhook configuration", async () => {
  const provider = creemPaymentProvider({ api_key: "creem_test", product_id: "prod_test" })
  assert.equal(provider.method({ env: () => undefined }).enabled, false)
  await assert.rejects(provider.parseWebhook(webhook_input({ id: "evt_2" }, "unused")), /not configured/)
})

test("Creem provider uses the Payment order amount as custom_price", async () => {
  const original_fetch = globalThis.fetch
  let request_body
  globalThis.fetch = async (_url, init) => {
    request_body = JSON.parse(init.body)
    return Response.json({ id: "checkout_1", checkout_url: "https://pay.creem.test/checkout_1" })
  }
  try {
    const provider = creemPaymentProvider({
      api_key: "creem_test",
      product_id: "prod_test",
      webhook_secret: "creem_webhook_test",
    })
    const result = await provider.createCheckout({
      payment_id: "pay_1",
      payment: {
        payment_id: "pay_1",
        user_id: "user_1",
        credits: 50_000,
        amount_minor: 500,
        currency: "usd",
        note: "充值",
      },
      request: new Request("http://localhost/checkout", { method: "POST" }),
      ctx: { env: () => undefined },
      success_url: "http://localhost/success",
      cancel_url: "http://localhost/cancel",
    })
    assert.equal(result.checkout_url, "https://pay.creem.test/checkout_1")
    assert.equal(request_body.product_id, "prod_test")
    assert.equal(request_body.custom_price, 500)
    assert.equal(request_body.metadata.amount_minor, 500)
  } finally {
    globalThis.fetch = original_fetch
  }
})

test("Creem provider rejects an invalid webhook signature", async () => {
  const provider = creemPaymentProvider({ webhook_secret: "creem_test" })
  await assert.rejects(provider.parseWebhook(webhook_input({ id: "evt_bad" }, "wrong_secret")), /Invalid Creem signature/)
})

function webhook_input(body, webhook_secret) {
  const raw = JSON.stringify(body)
  const signature = createHmac("sha256", webhook_secret).update(raw).digest("hex")
  return {
    raw,
    request: new Request("http://localhost/webhook", {
      method: "POST",
      body: raw,
      headers: { "creem-signature": signature },
    }),
    ctx: { env: () => undefined },
  }
}
