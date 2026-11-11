/** City 来源视图回归：共享 Federation 并发隔离、直接用户无来源、协议一致且不授予权限。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Federation, Service } from "../bin/index.js";
import { createSqliteDb } from "./sqlite-db.mjs";

/** 使用真实 Federation 路由，不访问网络或上游模型。 */
function create_source_federation() {
  const federation = new Federation({ database: createSqliteDb(":memory:") });
  const service = new Service({ id: "source_probe", name: "来源协议验证" });
  service.action("read", async (ctx) => {
    await new Promise(setImmediate);
    return { city_id: ctx.city_id ?? null, identity: ctx.identity.kind };
  }, { auth: [] });
  service.action("admin", async () => ({ ok: true }), { auth: ["admin"] });
  federation.use(service);
  return federation;
}

for (const mode of ["local", "remote"]) {
  test(`${mode}: City 来源按视图隔离，直接调用允许无来源`, async () => {
    const local = create_source_federation();
    const client = mode === "local" ? local : new Federation({
      url: "https://federation.invalid",
      fetch: (url, init) => local.fetch(new Request(url, init)),
    });
    try {
      const first = client.user.with_city("city_first");
      const second = client.user.with_city("city_second");
      const results = await Promise.all([
        first.service("source_probe").action("read").invoke(),
        second.service("source_probe").action("read").invoke(),
        client.user.service("source_probe").action("read").invoke(),
        first.with_city("city_third").service("source_probe").action("read").invoke(),
      ]);
      assert.deepEqual(results.map((row) => row.city_id), ["city_first", "city_second", null, "city_third"]);
      assert.ok(results.every((row) => row.identity === "guest"));
      const response = await local.fetch(new Request("https://federation.invalid/v1/source_probe/admin", {
        method: "POST", headers: { "x-downcity-city-id": "city_first" },
      }));
      assert.equal(response.status, 401, "来源标签不能建立管理员身份");
      const invalid = await local.fetch(new Request("https://federation.invalid/v1/source_probe/read", {
        method: "POST", headers: { "x-downcity-city-id": "a".repeat(129) },
      }));
      assert.equal(invalid.status, 400);
      for (const source of ["", "a b", "a/b", "a".repeat(129)]) {
        assert.throws(() => client.user.with_city(source), /city_id/u);
      }
    } finally {
      if (client !== local) await client.dispose();
      await local.dispose();
    }
  });
}

test("来源视图共用凭据更新，每次调用保留自己的身份快照", async () => {
  const requests = [];
  const federation = new Federation({ url: "https://example.invalid", user_token: "first", fetch: async (url, init) => {
    requests.push(init.headers);
    return new Response("{}", { headers: { "content-type": "application/json" } });
  } });
  try {
    const scoped = federation.user.with_city("city_fixed");
    const old_service = scoped.service("probe");
    federation.user.set_token("second");
    await old_service.action("read").invoke();
    await scoped.service("probe").action("read").invoke();
    assert.deepEqual(requests.map((headers) => headers.authorization), ["Bearer first", "Bearer second"]);
    assert.ok(requests.every((headers) => headers["x-downcity-city-id"] === "city_fixed"));
  } finally { await federation.dispose(); }
});
