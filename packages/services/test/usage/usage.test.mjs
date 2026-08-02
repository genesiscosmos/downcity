import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { Federation, AIService } from "@downcity/city"
import { create_test_text_model } from "../fixtures/ai-channel.mjs"
import { createSqliteDb } from "./sqlite-db.mjs"
import { UsageService } from "../../bin/index.js"

test("usageService records successful service calls", async () => {
  const cwd = process.cwd()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-usage-service-"))

  try {
    process.chdir(tempDir)
    const db = createSqliteDb(path.join(tempDir, "test.sqlite"))
    const base = new Federation({ database: db })
    base.use(new UsageService())

    const ai = new AIService()
    ai.use(create_test_text_model({
      id: "gpt-5.4",
      name: "GPT-5.4",
    }))
    base.use(ai)

    await base.health()
    const adminSecret = await readEnvValue(base, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY")

    const city = await (await base.fetch(adminRequest(adminSecret, {
      path: "/v1/bureaus/create",
      body: { name: "Demo", server_url: "https://bureau.example.com" },
    }))).json()
    const tokenBody = await (await base.getAuthenticator()).createToken({
      bureau_id: city.bureau_id,
      user_id: "user_1",
    })

    const invokeResponse = await base.fetch(new Request("http://localhost/v1/ai/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenBody.user_token}`,
      },
      body: JSON.stringify({ model: "gpt-5.4", prompt: "hi" }),
    }))
    assert.equal(invokeResponse.status, 200)

    const eventsResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/usage/events",
      method: "GET",
    }))
    assert.equal(eventsResponse.status, 200)
    const events = await eventsResponse.json()
    assert.equal(events.items.length, 1)
    assert.equal(events.items[0].service, "ai")
    assert.equal(events.items[0].status, "success")

    const summaryResponse = await base.fetch(adminRequest(adminSecret, {
      path: "/v1/usage/summary",
      method: "GET",
    }))
    assert.equal(summaryResponse.status, 200)
    assert.deepEqual(await summaryResponse.json(), {
      items: [
        {
          bureau_id: city.bureau_id,
          service: "ai",
          status: "success",
          count: 1,
        },
      ],
    })
  } finally {
    process.chdir(cwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

function adminRequest(adminSecret, { path: pathname, method = "POST", body }) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminSecret}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readEnvValue(base, key) {
  const envTable = await base.table("env")
  const rows = await envTable.select({ key })
  return rows[0]?.value ?? ""
}
