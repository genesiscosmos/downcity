/**
 * Credits Service 四表账务模型集成测试。
 */

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation } from "@downcity/city"
import { CreditsService } from "../../bin/index.js"
import { createSqliteDb } from "./sqlite-db.mjs"

test("CreditsService manages primary and ephemeral cards atomically", async () => {
  const cwd = process.cwd()
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-credits-"))
  try {
    process.chdir(temp_dir)
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const federation = new Federation({ db })
    const credits = new CreditsService()
    federation.use(credits)
    await federation.health()

    await credits.read("user_without_transactions")
    assert.deepEqual(
      (await credits.list_users()).map((item) => item.user_id),
      ["user_without_transactions"],
    )

    const primary_topup_input = {
      card: { kind: "primary", user_id: "user_1" },
      credits: 1_000,
      source: "payment",
      idempotency_key: "payment:1",
    }
    const [primary_topup, concurrent_primary_topup] = await Promise.all([
      credits.topup(primary_topup_input),
      credits.topup(primary_topup_input),
    ])
    assert.equal(concurrent_primary_topup.transaction_id, primary_topup.transaction_id)
    assert.equal(primary_topup.kind, "topup")
    assert.equal((await credits.read("user_1")).primary_credits, 1_000)
    assert.throws(
      () => db.$client.prepare(
        "UPDATE service_credits_primary_cards SET credits = -1 WHERE user_id = ?",
      ).run("user_1"),
      /primary card credits cannot be negative/,
    )
    assert.equal((await credits.read("user_1")).primary_credits, 1_000)

    const later_card = await credits.cards.create_ephemeral({
      user_id: "user_1",
      name: "later",
      initial_credits: 300,
      expires_at: new Date(Date.now() + 172_800_000).toISOString(),
      source: "reward",
      idempotency_key: "reward:later",
    })
    const earlier_card = await credits.cards.create_ephemeral({
      user_id: "user_1",
      name: "earlier",
      initial_credits: 200,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      source: "reward",
      idempotency_key: "reward:earlier",
    })
    const duplicate_card = await credits.cards.create_ephemeral({
      user_id: "user_1",
      name: "earlier",
      initial_credits: 200,
      expires_at: earlier_card.expires_at,
      source: "reward",
      idempotency_key: "reward:earlier",
    })
    assert.equal(duplicate_card.card_id, earlier_card.card_id)

    const charge = await credits.charge({
      user_id: "user_1",
      credits: 600,
      source: "model_usage",
      idempotency_key: "usage:1",
    })
    assert.equal(charge.kind, "charge")
    const entries = await credits.history({ transaction_id: charge.transaction_id })
    assert.deepEqual(entries.map((entry) => [entry.card_id, entry.credits_delta]), [
      [earlier_card.card_id, -200],
      [later_card.card_id, -300],
      ["user_1", -100],
    ].reverse())
    const summary = await credits.read("user_1")
    assert.equal(summary.primary_credits, 900)
    assert.equal(summary.ephemeral_credits, 0)
    assert.equal(summary.available_credits, 900)

    const expiring_card = await credits.cards.create_ephemeral({
      user_id: "user_1",
      name: "idempotency-before-expiration",
      initial_credits: 10,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      source: "reward",
      idempotency_key: "reward:expiring",
    })
    const expiring_topup = await credits.topup({
      card: { kind: "ephemeral", card_id: expiring_card.card_id },
      credits: 5,
      source: "reward",
      idempotency_key: "reward:expiring:topup",
    })
    db.$client.prepare(
      "UPDATE service_credits_ephemeral_cards SET expires_at = ? WHERE card_id = ?",
    ).run(new Date(Date.now() - 1_000).toISOString(), expiring_card.card_id)
    assert.equal((await credits.topup({
      card: { kind: "ephemeral", card_id: expiring_card.card_id },
      credits: 5,
      source: "reward",
      idempotency_key: "reward:expiring:topup",
    })).transaction_id, expiring_topup.transaction_id)

    await assert.rejects(
      credits.charge({
        user_id: "user_1",
        credits: 901,
        source: "model_usage",
        idempotency_key: "usage:overdraft",
      }),
      /insufficient credits/,
    )
    assert.equal((await credits.read("user_1")).primary_credits, 900)

    await assert.rejects(
      credits.topup({
        card: { kind: "primary", user_id: "user_1" },
        credits: 2,
        source: "payment",
        idempotency_key: "payment:1",
      }),
      /idempotency_key was already used/,
    )
  } finally {
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})
