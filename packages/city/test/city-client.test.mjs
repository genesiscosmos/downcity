import assert from "node:assert/strict"
import test from "node:test"

import { City, Bureau } from "../bin/index.js"

test("City rejects Federation rpc URLs", async () => {
  assert.throws(
    () => new City({
      federation_url: "rpc://127.0.0.1:15315",
      user_token: "ub_test",
    }),
    /http:\/\/ or https:\/\//,
  )
})

test("AIInvoker.base_url returns OpenAI-compatible endpoint", async () => {
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
  })

  assert.equal(city.ai.base_url, "https://api.example.com/base/v1/ai")
})

test("City user().profile() directly requests Federation Accounts", async () => {
  const requests = []
  const profile = {
    user_id: "user_1",
    email: "user@example.com",
    display_name: "User",
    avatar_url: "",
    bio: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }
  const city = new City({
    federation_url: "https://fed.example.com",
    user_token: "ub_test",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({ profile })
    },
  })

  assert.deepEqual(await city.user().profile(), profile)
  assert.equal(requests[0].url, "https://fed.example.com/v1/accounts/me")
  assert.equal(requests[0].init.headers.authorization, "Bearer ub_test")
})

test("AIInvoker.text() posts to /v1/ai/text", async () => {
  const requests = []
  const msg = { id: "msg_1", role: "assistant", parts: [{ type: "text", text: "hello", state: "done" }] }
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => { requests.push({ url, init }); return json(msg) },
  })
  const result = await city.ai.text({ model: "gpt-5.4", prompt: "hi" })
  assert.deepEqual(result, msg)
  assert.equal(requests[0].url, "https://api.example.com/base/v1/ai/text")
  assert.equal(requests[0].init.headers.authorization, "Bearer ub_test")
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: "gpt-5.4", prompt: "hi" })
})

test("AIInvoker.text() serializes reasoning_effort", async () => {
  const requests = []
  const msg = { id: "msg_1", role: "assistant", parts: [{ type: "text", text: "hello", state: "done" }] }
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => { requests.push({ url, init }); return json(msg) },
  })

  await city.ai.text({
    model: "gpt-5.4",
    prompt: "hi",
    reasoning_effort: "high",
  })

  assert.deepEqual(JSON.parse(requests[0].init.body), {
    model: "gpt-5.4",
    prompt: "hi",
    reasoning_effort: "high",
  })
})

test("AIInvoker.image_create() posts to /v1/ai/image/create", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({ job_id: "img_1", status: "queued", poll_after_ms: 2000 })
    },
  })

  const result = await city.ai.image_create({
    prompt: "draw a mug",
    model: "openai-gpt-image-1",
    size: "1024x1024",
    count: 1,
  })

  assert.deepEqual(result, { job_id: "img_1", status: "queued", poll_after_ms: 2000 })
  assert.equal(requests[0].url, "https://api.example.com/base/v1/ai/image/create")
  assert.equal(requests[0].init.headers.authorization, "Bearer ub_test")
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    prompt: "draw a mug",
    model: "openai-gpt-image-1",
    size: "1024x1024",
    count: 1,
  })
})

test("AIInvoker.image_result() posts to /v1/ai/image/result", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({ job_id: "img_1", status: "running", poll_after_ms: 2000 })
    },
  })

  const result = await city.ai.image_result({ job_id: "img_1" })

  assert.deepEqual(result, { job_id: "img_1", status: "running", poll_after_ms: 2000 })
  assert.equal(requests[0].url, "https://api.example.com/base/v1/ai/image/result")
  assert.equal(requests[0].init.headers.authorization, "Bearer ub_test")
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    job_id: "img_1",
  })
})

test("AIInvoker.text() serializes AI SDK provider tools with inputSchema", async () => {
  const requests = []
  const msg = { id: "msg_1", role: "assistant", parts: [{ type: "text", text: "hello" }] }
  const inputSchema = {
    type: "object",
    properties: {
      cmd: { type: "string", description: "Shell command" },
    },
    required: ["cmd"],
    additionalProperties: false,
  }
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => { requests.push({ url, init }); return json(msg) },
  })

  await city.ai.text({
    model: "gpt-5.4",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "run pwd" }] }],
    tools: [
      {
        type: "function",
        name: "exec_command",
        description: "Run shell command",
        inputSchema,
      },
    ],
  })

  assert.deepEqual(JSON.parse(requests[0].init.body).tools, [
    {
      type: "function",
      function: {
        name: "exec_command",
        description: "Run shell command",
        parameters: inputSchema,
      },
    },
  ])
})

test("User City delegates AI calls", async () => {
  const requests = []
  const msg = { id: "msg_1", role: "assistant", parts: [{ type: "text", text: "hello", state: "done" }] }
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async (url, init) => { requests.push({ url, init }); return json(msg) },
  })
  const result = await city.ai.text({ model: "gpt-5.4", prompt: "hi" })
  assert.deepEqual(result, msg)
  assert.equal(requests[0].url, "https://api.example.com/base/v1/ai/text")
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: "gpt-5.4", prompt: "hi" })
})

test("AIInvoker.catalog() returns ModelCatalog", async () => {
  const city = new City({
    federation_url: "https://api.example.com/base/",
    city_id: "city_demo", user_token: "ub_test",
    fetch: async () => json({ items: [
      { id: "gpt-5.4", name: "GPT-5.4", description: "P", modalities: ["text", "stream"], tags: [], price: ["输入：1 credit / 1K tokens"], meta: {}, env: {} },
      { id: "claude", name: "Claude", description: "A", modalities: ["text"], tags: [], meta: {}, env: {} },
    ]}),
  })
  const catalog = await city.ai.catalog()
  assert.equal(catalog.get("gpt-5.4").id, "gpt-5.4")
  assert.deepEqual(catalog.get("gpt-5.4").price, ["输入：1 credit / 1K tokens"])
  assert.equal(catalog.forModality("stream").length, 1)
  assert.equal(catalog.forModality("text").length, 2)
})

test("AIInvoker.stream() converts CityModel parts into UIMessage chunks", async () => {
  const requests = []
  const model_parts = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "hi" },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ]
  const city = new City({
    federation_url: "https://api.example.com/base/", city_id: "city_demo", user_token: "ub_test",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return streamResponse(model_parts.map((part) => ({
        protocol: "downcity-language-model-v1",
        part,
      })))
    },
  })
  const stream = await city.ai.stream({
    model: "gpt-5.4",
    prompt: "hi",
    reasoning_effort: "high",
    tools: {
      ping: {
        description: "Ping",
        inputSchema: {
          jsonSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      },
    },
  })
  const received = []; const reader = stream.getReader()
  while (true) { const { done, value } = await reader.read(); if (done) break; received.push(value) }
  assert.equal(requests[0].url, "https://api.example.com/base/v1/ai/stream")
  const request = JSON.parse(requests[0].init.body)
  assert.equal(request.protocol, "downcity-language-model-v1")
  assert.equal(request.model_id, "gpt-5.4")
  assert.equal(request.reasoning_effort, "high")
  assert.equal(request.call.prompt[0].role, "user")
  assert.equal(request.call.tools[0].type, "function")
  assert.equal(request.call.tools[0].name, "ping")
  assert.equal(received.find((part) => part.type === "text-delta")?.delta, "hi")
  assert.ok(received.some((part) => part.type === "finish"))
})

test("User City listServices()", async () => {
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "t",
    fetch: async () => json({
      items: [
        { id: "ai", name: "AI", env: [] },
        { id: "notes", name: "Notes", env: [{ key: "NOTES_KEY", description: "Notes API key", required: true }] },
      ],
    }),
  })
  assert.deepEqual(await city.listServices(), [
    { id: "ai", name: "AI", env: [] },
    { id: "notes", name: "Notes", env: [{ key: "NOTES_KEY", description: "Notes API key", required: true }] },
  ])
})

test("User City service() → ServiceInvoker", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/", user_token: "t", fetch: async (url, init) => { requests.push({ url, init }); return json({ ok: true }) } })
  const result = await city.service("notes").action("create").invoke({ title: "hello" })
  assert.deepEqual(result, { ok: true })
  assert.equal(requests[0].url, "https://api.example.com/base/v1/notes/create")
  assert.deepEqual(JSON.parse(requests[0].init.body), { title: "hello" })
})

test("City get() / post() use JSON and forward the current user_token", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://fed.example.com",
    user_token: "ub_user_token",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({ ok: true })
    },
  })
  const result = await city.post("https://bureau.example.com/reports/summary", {
    range: "today",
  })
  assert.deepEqual(result, { ok: true })
  await city.get("https://bureau.example.com/reports/status")
  assert.equal(requests[0].url, "https://bureau.example.com/reports/summary")
  assert.equal(requests[0].init.method, "POST")
  assert.equal(requests[0].init.body, JSON.stringify({ range: "today" }))
  assert.equal(requests[0].init.headers.accept, "application/json")
  assert.equal(requests[0].init.headers["content-type"], "application/json")
  assert.equal(requests[0].init.headers.authorization, "Bearer ub_user_token")
  assert.equal(requests[1].url, "https://bureau.example.com/reports/status")
  assert.equal(requests[1].init.method, "GET")
})

test("ServiceClient.get() appends query params for GET actions", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "t",
    fetch: async (url, init) => { requests.push({ url, init }); return json({ ok: true }) },
  })
  const result = await city.service("accounts").get("login/result", { login_id: "abc_123" })
  assert.deepEqual(result, { ok: true })
  assert.equal(requests[0].url, "https://api.example.com/base/v1/accounts/login/result?login_id=abc_123")
  assert.equal(requests[0].init.method, "GET")
})

test("User City payment.methods() reads the unified payment directory", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return json({
        items: [
          {
            id: "stripe",
            type: "checkout",
            enabled: true,
            label: "Stripe",
            service: "payment",
            action: "checkout/create",
            requires_user: true,
            currency: "usd",
          },
        ],
      })
    },
  })

  assert.deepEqual(await city.payment.methods(), [
    {
      id: "stripe",
      type: "checkout",
      enabled: true,
      label: "Stripe",
      service: "payment",
      action: "checkout/create",
      requires_user: true,
      currency: "usd",
    },
  ])
  assert.equal(requests[0].url, "https://api.example.com/base/v1/payment/methods")
  assert.equal(requests[0].init.method, "GET")
})

test("User City payment.method(id).invoke() dispatches to the unified payment checkout endpoint", async () => {
  const requests = []
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "t",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/v1/payment/methods")) {
        return json({
          items: [
            {
              id: "stripe",
              type: "checkout",
              enabled: true,
              label: "Stripe",
              service: "payment",
              action: "checkout/create",
              requires_user: true,
              currency: "usd",
            },
          ],
        })
      }
      return json({ checkout_url: "https://checkout.stripe.test/session_123" })
    },
  })

  const method = city.payment.method("stripe")
  assert.equal(method.id, "stripe")
  assert.equal((await method.describe()).service, "payment")
  assert.deepEqual(
    await method.invoke({ topup_amount_minor: 500, idempotency_key: "order_123" }),
    { checkout_url: "https://checkout.stripe.test/session_123" },
  )

  assert.equal(requests[1].url, "https://api.example.com/base/v1/payment/checkout/create")
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    topup_amount_minor: 500,
    idempotency_key: "order_123",
    method_id: "stripe",
  })
})

test("User City payment.method(id).invoke() rejects disabled or user-required methods early", async () => {
  const disabledClient = new City({
    federation_url: "https://api.example.com/base/",
    fetch: async () => json({
      items: [
        {
          id: "stripe",
          type: "checkout",
          enabled: false,
          label: "Stripe",
          service: "payment",
          action: "checkout/create",
          requires_user: true,
          currency: "usd",
          reason: "not_configured",
        },
      ],
    }),
  })

  await assert.rejects(
    disabledClient.payment.method("stripe").invoke({ topup_amount_minor: 500, idempotency_key: "order_123" }),
    /payment method "stripe" is disabled: not_configured/,
  )

  const guestClient = new City({
    federation_url: "https://api.example.com/base/",
    fetch: async () => json({
      items: [
        {
          id: "stripe",
          type: "checkout",
          enabled: true,
          label: "Stripe",
          service: "payment",
          action: "checkout/create",
          requires_user: true,
          currency: "usd",
        },
      ],
    }),
  })

  await assert.rejects(
    guestClient.payment.method("stripe").invoke({ topup_amount_minor: 500, idempotency_key: "order_123" }),
    /user_token is required for payment method "stripe"/,
  )
})

test("Bureau service() uses the shared /v1 route prefix", async () => {
  const requests = []
  const admin = new Bureau({
    federation_url: "http://localhost:3001/",
    bureau_token: "sk",
    fetch: async (url, init) => { requests.push({ url, init }); return json({ ok: true }) },
  })
  const result = await admin.service("usage").action("report").invoke({ range: "today" })
  assert.deepEqual(result, { ok: true })
  assert.equal(requests[0].url, "http://localhost:3001/v1/usage/report")
  assert.equal(requests[0].init.headers.authorization, "Bearer sk")
})

test("Bureau credits exposes typed Card and Transaction invokers", async () => {
  const requests = []
  const bureau = new Bureau({
    federation_url: "http://localhost:3001",
    bureau_token: "sk",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.includes("/users?")) return json({ items: [{ user_id: "user_1" }] })
      if (url.includes("/cards/ephemeral?")) return json({ items: [{ card_id: "card_1" }] })
      if (url.includes("/transactions?")) return json({ items: [{ transaction_id: "ctx_1" }] })
      if (url.includes("/history?")) return json({ items: [{ entry_id: "cte_1" }] })
      return json({ transaction_id: "ctx_1" })
    },
  })

  assert.equal((await bureau.credits.list_users({ limit: 5 }))[0].user_id, "user_1")
  assert.equal((await bureau.credits.cards.list_ephemeral({ user_id: "user_1" }))[0].card_id, "card_1")
  assert.equal((await bureau.credits.transactions.list({ user_id: "user_1" }))[0].transaction_id, "ctx_1")
  assert.equal((await bureau.credits.history.list({ user_id: "user_1" }))[0].entry_id, "cte_1")
  await bureau.credits.topup({
    card: { kind: "primary", user_id: "user_1" },
    credits: 100,
    source: "test",
    idempotency_key: "test:1",
  })
  assert.equal(requests[4].url, "http://localhost:3001/v1/credits/topups/create")
  assert.equal(requests[4].init.headers.authorization, "Bearer sk")
})

test("Bureau env list / catalog / upsert / remove", async () => {
  const requests = []
  const admin = new Bureau({
    federation_url: "http://localhost:3001/",
    bureau_token: "sk",
    fetch: async (url, init) => {
    requests.push({ url, init })
    if (url.endsWith("/v1/env/list")) return json({ items: [{ key: "K", value: "V", source: "database" }] })
    if (url.endsWith("/v1/env/catalog")) {
      return json({
        items: [
          {
            id: "accounts",
            name: "Accounts",
            env: [{ key: "BETTER_AUTH_SECRET", description: "secret", required: true, configured: true, value_preview: "better...cret" }],
          },
        ],
      })
    }
    return json({ success: true })
  }})
  const items = await admin.env.list()
  assert.deepEqual(items, [{ key: "K", value: "V", source: "database" }])
  const catalog = await admin.env.catalog()
  assert.deepEqual(catalog, [
    {
      id: "accounts",
      name: "Accounts",
      env: [{ key: "BETTER_AUTH_SECRET", description: "secret", required: true, configured: true, value_preview: "better...cret" }],
    },
  ])
  await admin.env.upsert({ key: "K2", value: "V2" })
  assert.equal(requests[2].url, "http://localhost:3001/v1/env/upsert")
  await admin.env.remove("K2")
  assert.equal(requests[3].url, "http://localhost:3001/v1/env/remove")
})

test("Bureau cities CRUD + tokens.apply", async () => {
  const requests = []; const p = { city_id: "p1", name: "Demo", status: "active", created_at: "t", updated_at: "t" }
  const admin = new Bureau({
    federation_url: "http://localhost:3001/",
    bureau_token: "sk",
    fetch: async (url, init) => {
    requests.push({ url, init })
    if (url.endsWith("/v1/cities/list")) return json({ items: [p] })
    if (url.endsWith("/v1/cities/create")) return json(p)
    if (url.endsWith("/v1/cities/tokens/apply")) return json({ user_token: "ub_test", city_id: "p1", user_id: "u1", expires_at: "2026-01-01T00:00:00.000Z" })
    return json({ success: true })
  }})
  assert.deepEqual(await admin.cities.list(), [p])
  assert.equal((await admin.cities.create({ name: "Demo" })).city_id, "p1")
  await admin.cities.pause("p1")
  assert.equal(requests[2].url, "http://localhost:3001/v1/cities/pause")
  assert.deepEqual(await admin.cities.tokens.apply({ city_id: "p1", user_id: "u1" }), {
    user_token: "ub_test",
    city_id: "p1",
    user_id: "u1",
    expires_at: "2026-01-01T00:00:00.000Z",
  })
})

test("Bureau bureaus register / list / revoke", async () => {
  const requests = []
  const bureau = {
    token_id: "br_1234567890abcdef",
    status: "active",
    created_at: "t",
    updated_at: "t",
  }
  const admin = new Bureau({
    federation_url: "http://localhost:3001/",
    bureau_token: "sk",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/v1/bureaus/register")) return json(bureau)
      if (url.endsWith("/v1/bureaus/list")) return json({ items: [bureau] })
      return json({ success: true })
    },
  })
  const input = {
    token_id: bureau.token_id,
    token_hash: "1234567890123456789012345678901234567890123",
  }
  assert.deepEqual(await admin.bureaus.register(input), bureau)
  assert.deepEqual(await admin.bureaus.list(), [bureau])
  await admin.bureaus.revoke(bureau.token_id)
  assert.equal(requests[0].url, "http://localhost:3001/v1/bureaus/register")
  assert.equal(requests[1].url, "http://localhost:3001/v1/bureaus/list")
  assert.equal(requests[2].url, "http://localhost:3001/v1/bureaus/revoke")
})

test("Bureau listServices() / listModels() / instruction()", async () => {
  const requests = []
  const admin = new Bureau({
    federation_url: "http://localhost:3001/",
    bureau_token: "sk",
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith("/v1/services")) {
        return json({
          items: [
            { id: "ai", name: "AI", env: [] },
            { id: "accounts", name: "Accounts", env: [{ key: "SMTP_URL", description: "smtp", required: true }] },
          ],
        })
      }
      if (url.endsWith("/v1/ai/models")) {
        return json({
          items: [
            {
              id: "gpt-5.4",
              name: "GPT-5.4",
              description: "model",
              modalities: ["text", "stream"],
              tags: [],
              price: ["Input: 1 credit / 1K tokens"],
              meta: {},
              env_requirements: [{ key: "OPENAI_API_KEY", description: "key", required: true }],
            },
          ],
        })
      }
      if (url.endsWith("/v1/federation/instruction")) {
        return text("Federation instruction document")
      }
      return json({ ok: true })
    },
  })

  assert.deepEqual(await admin.listServices(), [
    { id: "ai", name: "AI", env: [] },
    { id: "accounts", name: "Accounts", env: [{ key: "SMTP_URL", description: "smtp", required: true }] },
  ])
  assert.deepEqual(await admin.listModels(), [
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      description: "model",
      modalities: ["text", "stream"],
      tags: [],
      price: ["Input: 1 credit / 1K tokens"],
      meta: {},
      env_requirements: [{ key: "OPENAI_API_KEY", description: "key", required: true }],
    },
  ])
  assert.equal(await admin.instruction(), "Federation instruction document")
  assert.equal(requests[2].init.headers.authorization, "Bearer sk")
})

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: null, async json() { return body }, async text() { return JSON.stringify(body) } }
}

function text(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: null, async json() { return body }, async text() { return body } }
}

function streamResponse(chunks) {
  const e = new TextEncoder()
  return { ok: true, status: 200, body: new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(e.encode(`data: ${JSON.stringify(chunk)}\n\n`)); c.close() } }), async json() { return {} }, async text() { return "" } }
}

test("AIInvoker fetch retries transient 'fetch failed' errors", async () => {
  let calls = 0
  const msg = { id: "m", role: "assistant", parts: [{ type: "text", text: "ok", state: "done" }] }
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async () => {
      calls += 1
      if (calls < 3) {
        const cause = new Error("other side closed")
        cause.code = "UND_ERR_SOCKET"
        const err = new TypeError("fetch failed")
        err.cause = cause
        throw err
      }
      return json(msg)
    },
  })
  const result = await city.ai.text({ model: "gpt-5.4", prompt: "hi" })
  assert.deepEqual(result, msg)
  assert.equal(calls, 3)
})

test("AIInvoker fetch surfaces cause chain when retries exhausted", async () => {
  const city = new City({
    federation_url: "https://api.example.com/base/",
    user_token: "ub_test",
    fetch: async () => {
      const cause = new Error("other side closed")
      cause.code = "UND_ERR_SOCKET"
      const err = new TypeError("fetch failed")
      err.cause = cause
      throw err
    },
  })
  let captured
  try {
    await city.ai.text({ model: "gpt-5.4", prompt: "hi" })
  } catch (error) {
    captured = error
  }
  assert.ok(captured instanceof Error)
  assert.match(captured.message, /fetch failed/)
  assert.match(captured.message, /cause=UND_ERR_SOCKET other side closed/)
  assert.match(captured.message, /POST https:\/\/api\.example\.com\/base\/v1\/ai\/text/)
})
