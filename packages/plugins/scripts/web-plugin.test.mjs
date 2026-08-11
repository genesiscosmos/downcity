/**
 * WebPlugin provider-neutral action 回归测试。
 *
 * 关键点（中文）
 * - Plugin 必须显式注入 provider，不能只注册一段方法论。
 * - 浏览器 action 保持结构化输入输出，并在 lifecycle.stop 时释放 provider。
 * - 缺少某项 provider 时只让对应 action 返回明确失败。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ComputerUseBrowserProviderAdapter,
  SemanticBrowserProviderAdapter,
  WebPlugin,
} from "../bin/index.js";

function create_browser_provider() {
  const sessions = new Map();
  let disposed = false;
  return {
    name: "mock-browser",
    get disposed() { return disposed; },
    async create_session(input) {
      const session_id = "browser-session-1";
      const state = {
        provider: this.name,
        session_id,
        url: input.url || "about:blank",
        title: "Mock page",
        text: "Initial page",
      };
      sessions.set(session_id, state);
      return state;
    },
    async observe(input) {
      const state = sessions.get(input.session_id);
      if (!state) throw new Error(`Browser session not found: ${input.session_id}`);
      return state;
    },
    async act(input) {
      const state = sessions.get(input.session_id);
      if (!state) throw new Error(`Browser session not found: ${input.session_id}`);
      const next = { ...state, text: `acted:${input.action.type}` };
      sessions.set(input.session_id, next);
      return next;
    },
    async extract(input) {
      const state = sessions.get(input.session_id);
      if (!state) throw new Error(`Browser session not found: ${input.session_id}`);
      return {
        provider: this.name,
        session_id: input.session_id,
        url: state.url,
        content: state.text,
      };
    },
    async close_session(input) {
      sessions.delete(input.session_id);
    },
    async dispose() {
      sessions.clear();
      disposed = true;
    },
  };
}

test("WebPlugin 拒绝没有真实能力的空配置", () => {
  assert.throws(() => new WebPlugin({}), /requires at least one provider/);
});

test("WebPlugin 暴露结构化联网与浏览器 actions", () => {
  const plugin = new WebPlugin({ browser: create_browser_provider() });
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
  assert.equal(plugin.actions.install, undefined);
  assert.match(plugin.system(), /deterministic CSS-selector operations/);
});

test("search 与 open 委托给独立 provider", async () => {
  const plugin = new WebPlugin({
    search: async (input) => ({
      provider: "mock-search",
      items: [{ url: "https://example.com", title: input.query }],
    }),
    open: async (input) => ({
      provider: "mock-reader",
      url: input.url,
      title: "Example",
      content: "Example content",
    }),
  });

  const search_result = await plugin.actions.search.execute({
    context: {},
    input: { query: "official docs" },
  });
  const open_result = await plugin.actions.open.execute({
    context: {},
    input: { url: "https://example.com" },
  });

  assert.equal(search_result.success, true);
  assert.equal(search_result.data.provider, "mock-search");
  assert.equal(open_result.success, true);
  assert.equal(open_result.data.content, "Example content");
});

test("浏览器 session 完整执行 create、act、extract 与 close", async () => {
  const browser = create_browser_provider();
  const plugin = new WebPlugin({ browser });
  const created = await plugin.actions.browser_create_session.execute({
    context: {},
    input: { url: "https://example.com" },
  });
  const session_id = created.data.session_id;

  const acted = await plugin.actions.browser_act.execute({
    context: {},
    input: { session_id, action: { type: "click", selector: "a" } },
  });
  const extracted = await plugin.actions.browser_extract.execute({
    context: {},
    input: { session_id },
  });
  const closed = await plugin.actions.browser_close_session.execute({
    context: {},
    input: { session_id },
  });

  assert.equal(created.success, true);
  assert.equal(acted.data.text, "acted:click");
  assert.equal(extracted.data.content, "acted:click");
  assert.deepEqual(closed.data, { session_id, closed: true });
});

test("语义 adapter 复用基础 session 并暴露语义 actions", async () => {
  const base_browser = create_browser_provider();
  const browser = new SemanticBrowserProviderAdapter({
    name: "mock-semantic",
    browser: base_browser,
    semantic_act: async (input) => ({
      ...(await base_browser.observe({ session_id: input.session_id })),
      text: `semantic:${input.instruction}`,
    }),
    semantic_extract: async (input) => ({
      provider: "mock-semantic",
      session_id: input.session_id,
      url: "https://example.com",
      content: `semantic-extract:${input.instruction}`,
    }),
  });
  const plugin = new WebPlugin({ browser });
  const created = await plugin.actions.browser_create_session.execute({
    context: {},
    input: { url: "https://example.com" },
  });
  const session_id = created.data.session_id;
  const acted = await plugin.actions.browser_semantic_act.execute({
    context: {},
    input: { session_id, instruction: "click the login button" },
  });
  const extracted = await plugin.actions.browser_semantic_extract.execute({
    context: {},
    input: { session_id, instruction: "extract the account name" },
  });

  assert.equal(acted.success, true);
  assert.equal(acted.data.text, "semantic:click the login button");
  assert.equal(extracted.data.content, "semantic-extract:extract the account name");
});

test("Computer Use adapter 先获取截图观察再委托模型循环", async () => {
  const base_browser = create_browser_provider();
  const browser = new ComputerUseBrowserProviderAdapter({
    name: "mock-computer-use",
    browser: base_browser,
    run: async ({ instruction, observation }) => ({
      ...observation,
      text: `computer-use:${instruction}`,
      screenshot_data_url: observation.screenshot_data_url ?? "data:image/png;base64,mock",
    }),
  });
  const plugin = new WebPlugin({ browser });
  const created = await plugin.actions.browser_create_session.execute({
    context: {},
    input: { url: "https://example.com" },
  });
  const result = await plugin.actions.browser_semantic_act.execute({
    context: {},
    input: {
      session_id: created.data.session_id,
      instruction: "drag the map",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.text, "computer-use:drag the map");
  assert.match(result.data.screenshot_data_url, /^data:image\/png;base64/);
});

test("未配置的 action 返回明确失败，lifecycle.stop 释放浏览器", async () => {
  const browser = create_browser_provider();
  const plugin = new WebPlugin({ browser });
  const search_result = await plugin.actions.search.execute({
    context: {},
    input: { query: "test" },
  });
  assert.equal(search_result.success, false);
  assert.match(search_result.error, /not configured/);

  await plugin.lifecycle.stop({});
  assert.equal(browser.disposed, true);
});
