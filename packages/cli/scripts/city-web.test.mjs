/** City Web 本地 Server 的安全边界回归测试。 */
import assert from "node:assert/strict";
import test from "node:test";
import { start_city_web_server } from "../bin/city/web/CityWebServer.js";

test("city web only accepts loopback listeners", async () => {
  await assert.rejects(
    () => start_city_web_server({ host: "0.0.0.0", port: 0, open: false }),
    /loopback/,
  );
});

test("city web serves the static entry and protects API with a process cookie", async () => {
  const binding = await start_city_web_server({ host: "127.0.0.1", port: 0, open: false });
  try {
    const page = await fetch(binding.url);
    assert.equal(page.status, 200);
    const cookie = page.headers.get("set-cookie");
    assert.match(cookie ?? "", /city_web_session=/);
    const denied = await fetch(`${binding.url}/api/context`);
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${binding.url}/api/context`, { headers: { cookie: `theme=dark; ${cookie.split(";")[0]}; other=value` } });
    assert.equal(allowed.status, 200);
  } finally {
    await binding.close();
  }
});
