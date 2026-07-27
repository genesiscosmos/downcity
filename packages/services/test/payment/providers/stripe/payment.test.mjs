/** Stripe Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { stripePaymentProvider } from "../../../../bin/index.js"

test("Stripe provider maps paid webhook to a Payment order", async () => {
  const provider = stripePaymentProvider()
  const event = await provider.parseWebhook(webhook_input({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", payment_intent: "pi_1", metadata: { payment_id: "pay_1" } } },
  }))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_session_id, "cs_1")
})

function webhook_input(body) {
  const raw = JSON.stringify(body)
  return { raw, request: new Request("http://localhost/webhook", { method: "POST", body: raw }), ctx: { env: () => undefined } }
}
