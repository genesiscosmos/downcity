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
    const federation = new Federation({ database: db })
    const credits = new CreditsService()
    federation.use(credits)
    await federation.health()

    for (const route_path of [
      "/v1/credits/me",
      "/v1/credits/transactions/me",
    ]) {
      const response = await federation.fetch(new Request(`http://localhost${route_path}`, {
        headers: {
          authorization: "Bearer invalid-token",
        },
      }))
      assert.equal(response.status, 401, `${route_path} should be registered and require authentication`)
    }

    await credits.read_account("user_without_transactions")
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
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 1_000)
    await assert.rejects(
      db.query({
        sql: "UPDATE service_credits_primary_cards SET credits = -1 WHERE user_id = ?",
        params: ["user_1"],
      }),
      /primary card credits cannot be negative/,
    )
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 1_000)

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

    const account_before_charge = await credits.read_account("user_1")
    assert.equal(account_before_charge.available_credits, 1_500)
    assert.equal(account_before_charge.cards.primary.credits, 1_000)
    assert.deepEqual(
      account_before_charge.cards.ephemeral.map((card) => card.card_id),
      [earlier_card.card_id, later_card.card_id],
    )

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
    const account = await credits.read_account("user_1")
    assert.equal(account.cards.primary.credits, 900)
    assert.deepEqual(account.cards.ephemeral, [])
    assert.equal(account.available_credits, 900)

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
    await db.query({
      sql: "UPDATE service_credits_ephemeral_cards SET expires_at = ? WHERE card_id = ?",
      params: [new Date(Date.now() - 1_000).toISOString(), expiring_card.card_id],
    })
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
    assert.equal((await credits.read_account("user_1")).cards.primary.credits, 900)

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

test("CreditsService enforces expiration, active card, safe total, and full idempotency boundaries", async () => {
  const cwd = process.cwd()
  const temp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-credits-limits-"))
  try {
    process.chdir(temp_dir)
    const db = createSqliteDb(path.join(temp_dir, "test.sqlite"))
    const federation = new Federation({ database: db })
    const credits = new CreditsService()
    federation.use(credits)
    await federation.health()

    await assert.rejects(
      credits.cards.create_ephemeral({
        user_id: "date_user",
        name: "invalid date",
        initial_credits: 1,
        expires_at: new Date(Date.now() + 86_400_000).toUTCString(),
        source: "test",
        idempotency_key: "date:invalid",
      }),
      /ISO 8601/,
    )

    const expiring = await credits.cards.create_ephemeral({
      user_id: "date_user",
      name: "expires",
      initial_credits: 10,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      source: "test",
      idempotency_key: "date:expires",
    })
    await db.query({
      sql: "UPDATE service_credits_ephemeral_cards SET expires_at = ? WHERE card_id = ?",
      params: [new Date(Date.now() - 1_000).toISOString(), expiring.card_id],
    })
    assert.equal((await credits.read_account("date_user")).available_credits, 0)
    await assert.rejects(credits.cards.get_ephemeral(expiring.card_id), /not found/)

    const expires_at = new Date(Date.now() + 86_400_000).toISOString()
    for (let index = 0; index < 100; index++) {
      await credits.cards.create_ephemeral({
        user_id: "card_limit_user",
        name: `card ${index}`,
        initial_credits: 1,
        expires_at,
        source: "test",
        idempotency_key: `card_limit:${index}`,
      })
    }
    await assert.rejects(
      credits.cards.create_ephemeral({
        user_id: "card_limit_user",
        name: "card 101",
        initial_credits: 1,
        expires_at,
        source: "test",
        idempotency_key: "card_limit:101",
      }),
      /active ephemeral card limit exceeded/,
    )
    await credits.charge({
      user_id: "card_limit_user",
      credits: 100,
      source: "test",
      idempotency_key: "card_limit:charge",
    })
    assert.equal((await credits.read_account("card_limit_user")).available_credits, 0)

    const maximum_topup = await credits.topup({
      card: { kind: "primary", user_id: "safe_user" },
      credits: Number.MAX_SAFE_INTEGER,
      source: "test",
      ref: "maximum",
      metadata: { left: 1, right: 2 },
      idempotency_key: "safe:maximum",
    })
    const reordered_retry = await credits.topup({
      card: { user_id: "safe_user", kind: "primary" },
      credits: Number.MAX_SAFE_INTEGER,
      source: "test",
      ref: "maximum",
      metadata: { right: 2, left: 1 },
      idempotency_key: "safe:maximum",
    })
    assert.equal(reordered_retry.transaction_id, maximum_topup.transaction_id)
    await assert.rejects(
      credits.topup({
        card: { kind: "primary", user_id: "safe_user" },
        credits: 1,
        source: "test",
        idempotency_key: "safe:overflow",
      }),
      /user credits limit exceeded/,
    )
    assert.equal(Number.isSafeInteger((await credits.read_account("safe_user")).available_credits), true)
    await assert.rejects(
      credits.topup({
        card: { kind: "primary", user_id: "safe_user" },
        credits: Number.MAX_SAFE_INTEGER,
        source: "different_source",
        ref: "maximum",
        metadata: { left: 1, right: 2 },
        idempotency_key: "safe:maximum",
      }),
      /idempotency_key was already used/,
    )
  } finally {
    process.chdir(cwd)
    await fs.rm(temp_dir, { recursive: true, force: true })
  }
})
