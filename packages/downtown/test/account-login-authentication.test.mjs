/** 账户重新登录回归：公开登录独立于旧会话，受保护请求仍使用动态凭证。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Downtown } from "../bin/index.js";

for (const city_id of [undefined, "city_relogin"]) {
  test(`${city_id ?? "direct"}: 失效会话仍可获取 Provider 并完成多步骤重新登录`, async () => {
    const requests = [];
    let resolver_calls = 0;
    const expired = Object.assign(new Error("Login session expired or revoked; sign in again"), { status: 401 });
    const provider = { id: "email", label: "Email", type: "email", enabled: true };
    const downtown = new Downtown({
      url: "https://downtown.invalid",
      user_token: "expired_token",
      resolve_user_token: async () => { resolver_calls++; throw expired; },
      fetch: async (url, init) => {
        requests.push({ url, init });
        const path = new URL(url).pathname;
        if (path === "/v1/accounts/providers") return Response.json({ items: [provider] });
        if (path === "/v1/accounts/login/start") return Response.json({
          status: "input_required", login_id: "login_new", login_secret: "private_login_proof",
        });
        if (path === "/v1/accounts/login/continue" || path === "/v1/accounts/login/result") {
          return Response.json({ status: "done", login_id: "login_new" });
        }
        if (path === "/v1/accounts/login/exchange") return Response.json({
          status: "done", login_id: "login_new", user_token: "new_token",
        });
        assert.equal(path, "/v1/accounts/me");
        return Response.json({ user: { user_id: "user_new" }, profile: null });
      },
    });
    const user = city_id ? downtown.user.with_city(city_id) : downtown.user;
    try {
      await assert.rejects(user.current(), { status: 401 });
      assert.equal(requests.length, 0, "受保护请求不能回退旧 Token");
      assert.deepEqual(await user.account.providers(), [provider]);
      assert.equal(resolver_calls, 1, "获取登录方式不读取旧会话");
      await assert.rejects(user.service("business").action("write").invoke(), { status: 401 });
      assert.equal(requests.length, 1, "获取登录方式不会清除旧凭证或放行后续业务请求");

      await user.account.login_start({ provider: "email", client_type: "desktop" });
      await user.account.continue({ input: { email: "user@example.com", password: "password" } });
      await user.account.status();
      assert.equal(user.account.token(), "expired_token", "完成交换前保留原有凭证");
      await user.account.exchange();
      assert.equal(resolver_calls, 2, "整个公开登录流程不调用旧会话读取器");
      assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
        "/v1/accounts/providers", "/v1/accounts/login/start", "/v1/accounts/login/continue",
        "/v1/accounts/login/result", "/v1/accounts/login/exchange",
      ]);
      assert.ok(requests.every(({ init }) => init.headers.authorization === undefined), "公开登录不发送旧 Token");
      assert.ok(requests.every(({ init }) => init.headers["x-downcity-city-id"] === city_id));
      for (const request of requests.slice(2)) {
        assert.equal(JSON.parse(request.init.body).login_secret, "private_login_proof", "公开登录仍携带事务证明");
      }

      assert.equal(downtown.user.account.token(), "new_token", "来源视图交换后更新共享凭据");
      assert.equal((await user.current()).user.user_id, "user_new");
      assert.equal(requests.at(-1).init.headers.authorization, "Bearer new_token");
      assert.equal(resolver_calls, 2, "重新登录后停止使用旧会话读取器");
    } finally { await downtown.dispose(); }
  });
}

test("公开登录失败保留服务端错误，后续业务仍使用动态凭证", async () => {
  const requests = [];
  let resolver_calls = 0;
  const downtown = new Downtown({
    url: "https://downtown.invalid",
    user_token: "old_token",
    resolve_user_token: async () => { resolver_calls++; return "renewed_token"; },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/providers")) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
      return Response.json({ user: { user_id: "user_current" }, profile: null });
    },
  });
  try {
    await assert.rejects(downtown.user.account.providers(), { status: 503 });
    assert.equal(resolver_calls, 0);
    assert.equal(requests[0].init.headers.authorization, undefined);
    assert.equal((await downtown.user.current()).user.user_id, "user_current");
    assert.equal(resolver_calls, 1);
    assert.equal(requests[1].init.headers.authorization, "Bearer renewed_token");
  } finally { await downtown.dispose(); }
});
