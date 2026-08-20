/** WebPlugin 配置与运行时上下文能力回归测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { WebPlugin } from "../bin/index.js";

test("WebPlugin 允许空配置并暴露稳定 actions", () => {
  const plugin = new WebPlugin();
  assert.deepEqual(Object.keys(plugin.actions), [
    "search",
    "open",
    "browser_create_session",
    "browser_observe",
    "browser_act",
    "browser_semantic_act",
    "browser_extract",
    "browser_semantic_extract",
    "browser_close_session",
  ]);
  assert.match(plugin.system(), /direct search or document reading/u);
});

test("search 与 open 从 PluginContext 读取宿主 Web 能力", async () => {
  const plugin = new WebPlugin();
  const context = {
    web: {
      async search(input) {
        return {
          provider: "mock-search",
          items: [{ url: "https://example.com", title: input.query }],
        };
      },
      async open(input) {
        return {
          provider: "mock-reader",
          url: input.url,
          title: "Example",
          content: "Example content",
        };
      },
    },
  };
  const search_result = await plugin.actions.search.execute({
    context,
    input: { query: "official docs" },
  });
  const open_result = await plugin.actions.open.execute({
    context,
    input: { url: "https://example.com" },
  });
  assert.equal(search_result.success, true);
  assert.equal(search_result.data.provider, "mock-search");
  assert.equal(open_result.success, true);
  assert.equal(open_result.data.content, "Example content");
});

test("缺少运行时能力或 CDP 配置时只让对应 action 失败", async () => {
  const plugin = new WebPlugin();
  const search_result = await plugin.actions.search.execute({
    context: {},
    input: { query: "test" },
  });
  const browser_result = await plugin.actions.browser_create_session.execute({
    context: {},
    input: { url: "https://example.com" },
  });
  assert.equal(search_result.success, false);
  assert.match(search_result.error, /not configured/u);
  assert.equal(browser_result.success, false);
  assert.match(browser_result.error, /not configured/u);
  await plugin.lifecycle.stop();
});

test("WebPlugin 只接受公开的浏览器 provider 枚举", () => {
  assert.doesNotThrow(() => new WebPlugin({ browser: "playwright" }));
  assert.throws(
    () => new WebPlugin({ browser: "unknown" }),
    /Unsupported Web browser provider/u,
  );
});
