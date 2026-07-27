/** Waffo Provider webhook 投影测试。 */

import assert from "node:assert/strict"
import { createPublicKey, sign } from "node:crypto"
import test from "node:test"
import { waffoPaymentProvider } from "../../../../bin/index.js"
import { fallbackWaffoPrivateKey } from "../../../../bin/payment/providers/waffo/client.js"

test("Waffo provider maps paid webhook to a Payment order", async () => {
  const private_key = fallbackWaffoPrivateKey()
  const webhook_public_key = createPublicKey(private_key).export({ type: "spki", format: "pem" }).toString()
  const provider = waffoPaymentProvider({ webhook_public_key })
  const event = await provider.parseWebhook(webhook_input({
    eventId: "evt_1",
    eventType: "order.completed",
    data: {
      orderId: "order_1",
      paymentId: "provider_pay_1",
      orderMerchantExternalId: "pay_1",
      orderMetadata: { payment_id: "pay_1" },
    },
  }, private_key))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_order_id, "order_1")
})

function webhook_input(body, private_key) {
  const raw = JSON.stringify(body)
  const timestamp = String(Date.now())
  const signature = sign("RSA-SHA256", Buffer.from(`${timestamp}.${raw}`), private_key).toString("base64")
  return {
    raw,
    request: new Request("http://localhost/webhook", {
      method: "POST",
      body: raw,
      headers: { "x-waffo-signature": `t=${timestamp},v1=${signature}` },
    }),
    ctx: { env: () => undefined },
  }
}
