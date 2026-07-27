/** Creem Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { creemPaymentProvider } from "../../../../bin/index.js"

test("Creem provider maps paid webhook to a Payment order", async () => {
  const provider = creemPaymentProvider()
  const event = await provider.parseWebhook(webhook_input({
    id: "evt_1",
    eventType: "checkout.completed",
    object: { id: "checkout_1", order: { id: "order_1" }, metadata: { payment_id: "pay_1" } },
  }))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_order_id, "order_1")
})

function webhook_input(body) {
  const raw = JSON.stringify(body)
  return { raw, request: new Request("http://localhost/webhook", { method: "POST", body: raw }), ctx: { env: () => undefined } }
}
