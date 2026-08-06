/** `fed web` 本地 BFF、安全会话与静态资源回归测试。 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { start_federation_web_server } from "../bin/federation/web/FederationWebServer.js";

test("fed web serves UI and keeps admin credential behind the local BFF", async () => {
  const remote_requests = [];
  const remote_server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      remote_requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(mock_federation_response(request.url)));
    });
  });
  await new Promise((resolve) => remote_server.listen(0, "127.0.0.1", resolve));
  const remote_address = remote_server.address();
  assert.ok(remote_address && typeof remote_address !== "string");

  const binding = await start_federation_web_server({
    federation_name: "Test Federation",
    federation_url: `http://127.0.0.1:${remote_address.port}`,
    admin_secret_key: "test-admin-secret",
  }, { host: "127.0.0.1", port: 0 });

  try {
    const index_response = await fetch(binding.url);
    assert.equal(index_response.status, 200);
    const index_html = await index_response.text();
    assert.match(index_html, /Downcity Federation/);
    const asset_path = index_html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.ok(asset_path?.startsWith("./assets/"));
    const cookie = index_response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("fed_web_session="));

    const asset_response = await fetch(new URL(asset_path, `${binding.url}/`));
    assert.equal(asset_response.status, 200);
    assert.match(asset_response.headers.get("content-type") ?? "", /javascript/);
    const asset_source = await asset_response.text();
    assert.match(asset_source, /数据概览/);
    assert.match(asset_source, /Token 消耗排行/);
    assert.doesNotMatch(asset_source, /test-admin-secret/);

    const denied_response = await fetch(`${binding.url}/api/context`);
    assert.equal(denied_response.status, 403);

    const context_response = await fetch(`${binding.url}/api/context`, { headers: { cookie } });
    assert.deepEqual(await context_response.json(), {
      federation_name: "Test Federation",
      federation_url: `http://127.0.0.1:${remote_address.port}`,
    });

    const dashboard_response = await fetch(`${binding.url}/api/dashboard?range=7d`, { headers: { cookie } });
    assert.equal(dashboard_response.status, 200);
    assert.equal((await dashboard_response.json()).range, "7d");

    const users_response = await fetch(`${binding.url}/api/resources/users`, { headers: { cookie } });
    assert.equal(users_response.status, 200);
    assert.equal((await users_response.json()).items.length, 1);

    const usage_overview_response = await fetch(`${binding.url}/api/usage/overview?range=30d&timezone=UTC`, { headers: { cookie } });
    assert.equal(usage_overview_response.status, 200);
    const usage_overview = await usage_overview_response.json();
    assert.equal(usage_overview.total_registered_users, 1);
    assert.equal(usage_overview.activity.daily_active_users, 1);

    const usage_users_response = await fetch(`${binding.url}/api/usage/users?range=30d&timezone=UTC`, { headers: { cookie } });
    assert.equal(usage_users_response.status, 200);
    const usage_users = await usage_users_response.json();
    assert.equal(usage_users.items[0].email, "user@example.com");
    assert.equal(usage_users.items[0].total_tokens, 30);

    const retention_response = await fetch(`${binding.url}/api/usage/retention?range=30d&timezone=UTC`, { headers: { cookie } });
    assert.equal(retention_response.status, 200);
    assert.equal((await retention_response.json()).total_registered_users, 1);

    const action_response = await fetch(`${binding.url}/api/actions`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "env_upsert", payload: { key: "DEMO", value: "value" } }),
    });
    assert.equal(action_response.status, 200);
    const env_request = remote_requests.find((item) => item.url === "/v1/env/upsert");
    assert.equal(env_request?.authorization, "Bearer test-admin-secret");
    assert.equal(env_request?.body, JSON.stringify({ key: "DEMO", value: "value" }));
  } finally {
    await binding.close();
    await new Promise((resolve, reject) => remote_server.close((error) => error ? reject(error) : resolve()));
  }
});

function mock_federation_response(url) {
  if (url === "/v1/env/upsert") return { success: true };
  if (url === "/v1/accounts/users") {
    return { items: [{ user_id: "user_1", email: "user@example.com", created_at: new Date().toISOString() }] };
  }
  if (url?.startsWith("/v1/usage/admin/overview?")) {
    return {
      timezone: "UTC",
      from: "2026-07-07",
      to: "2026-08-05",
      activity: {
        range_active_users: 1,
        daily_active_users: 1,
        weekly_active_users: 1,
        monthly_active_users: 1,
        daily_monthly_stickiness: 1,
      },
      summary: {
        execution_count: 2,
        succeeded_count: 2,
        failed_count: 0,
        success_rate: 1,
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        credits_used: 5,
        charge_count: 2,
      },
      days: [{ date: "2026-08-05", active_user_count: 1, execution_count: 2, total_tokens: 30, credits_used: 5 }],
    };
  }
  if (url?.startsWith("/v1/usage/admin/users?")) {
    return { items: [{ user_id: "user_1", execution_count: 2, total_tokens: 30, credits_used: 5 }] };
  }
  if (url?.startsWith("/v1/usage/admin/retention?")) {
    return {
      total_registered_users: 1,
      registration_days: [],
      cohorts: [],
      average_rates: { day_1: null, day_3: null, day_7: null, day_14: null, day_30: null },
    };
  }
  return { items: [] };
}

test("fed web rejects non-loopback listeners", async () => {
  await assert.rejects(
    start_federation_web_server({
      federation_name: "Unsafe",
      federation_url: "http://127.0.0.1:1",
      admin_secret_key: "secret",
    }, { host: "0.0.0.0", port: 0 }),
    /只允许监听/,
  );
});
