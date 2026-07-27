/** Stripe Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { stripePaymentProvider } from "../../../../bin/index.js"

test("Stripe provider maps paid webhook to a Payment order", async () => {
  const webhook_secret = "whsec_test"
  const provider = stripePaymentProvider({ webhook_secret })
  const event = await provider.parseWebhook(webhook_input({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", payment_intent: "pi_1", payment_status: "paid", metadata: { payment_id: "pay_1" } } },
  }, webhook_secret))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_session_id, "cs_1")

  const unpaid = await provider.parseWebhook(webhook_input({
    id: "evt_unpaid",
    type: "checkout.session.completed",
    data: { object: { id: "cs_unpaid", payment_status: "unpaid", metadata: { payment_id: "pay_unpaid" } } },
  }, webhook_secret))
  assert.equal(unpaid.status, "pending")
})

test("Stripe provider rejects missing webhook configuration", async () => {
  const provider = stripePaymentProvider({ secret_key: "sk_test" })
  assert.equal(provider.method({ env: () => undefined }).enabled, false)
  await assert.rejects(provider.parseWebhook(webhook_input({ id: "evt_2" }, "unused")), /not configured/)
})

test("Stripe provider rejects an invalid webhook signature", async () => {
  const provider = stripePaymentProvider({ webhook_secret: "whsec_test" })
  await assert.rejects(provider.parseWebhook(webhook_input({ id: "evt_bad" }, "wrong_secret")), /Invalid Stripe signature/)
})

function webhook_input(body, webhook_secret) {
  const raw = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac("sha256", webhook_secret).update(`${timestamp}.${raw}`).digest("hex")
  return {
    raw,
    request: new Request("http://localhost/webhook", {
      method: "POST",
      body: raw,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    }),
    ctx: { env: () => undefined },
  }
}
