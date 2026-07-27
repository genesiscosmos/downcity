/** Dodo Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { dodoPaymentProvider } from "../../../../bin/index.js"

test("Dodo provider maps paid webhook to a Payment order", async () => {
  const provider = dodoPaymentProvider()
  const event = await provider.parseWebhook(webhook_input({
    id: "evt_1",
    type: "payment.succeeded",
    data: { payment_id: "provider_pay_1", metadata: { payment_id: "pay_1" } },
  }))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_payment_id, "provider_pay_1")
})

function webhook_input(body) {
  const raw = JSON.stringify(body)
  return { raw, request: new Request("http://localhost/webhook", { method: "POST", body: raw }), ctx: { env: () => undefined } }
}
