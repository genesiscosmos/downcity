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
    id: "evt_1",
    type: "payment.succeeded",
    data: { payment_id: "provider_pay_1", metadata: { payment_id: "pay_1" } },
  }, webhook_key_bytes))
  assert.equal(event.status, "paid")
  assert.equal(event.payment_id, "pay_1")
  assert.equal(event.provider_payment_id, "provider_pay_1")
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

function webhook_input(body, webhook_key_bytes) {
  const raw = JSON.stringify(body)
  const webhook_id = "webhook_test"
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac("sha256", webhook_key_bytes)
    .update(`${webhook_id}.${timestamp}.${raw}`)
    .digest("base64")
  return {
    raw,
    request: new Request("http://localhost/webhook", {
      method: "POST",
      body: raw,
      headers: {
        "webhook-id": webhook_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
    }),
    ctx: { env: () => undefined },
  }
}
