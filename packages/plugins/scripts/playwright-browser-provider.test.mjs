/**
 * PlaywrightBrowserProvider 的 CDP 连接与页面所有权专项测试。
 *
 * 关键点（中文）
 * - 通过 Node 模块 mock 隔离真实 CDP endpoint，只验证 provider 的连接契约。
 * - 默认 context 和既有 page 均属于外部浏览器，测试确保 provider 不接管或关闭它们。
 * - 每个用例使用独立 provider 和 browser，避免 session registry 在测试之间共享。
 */

import assert from "node:assert/strict";
import test, { mock } from "node:test";

const connect_calls = [];
let current_browser;

mock.module("playwright-core", {
  namedExports: {
    chromium: {
      async connectOverCDP(...args) {
        connect_calls.push(args);
        if (current_browser instanceof Error) throw current_browser;
        return current_browser;
      },
    },
  },
});

const { PlaywrightBrowserProvider } = await import("../bin/web.js");

function create_page(overrides = {}) {
  return {
    closed: false,
    default_timeout: null,
    default_navigation_timeout: null,
    goto_calls: [],
    setDefaultTimeout(value) { this.default_timeout = value; },
    setDefaultNavigationTimeout(value) { this.default_navigation_timeout = value; },
    async goto(...args) { this.goto_calls.push(args); },
    locator() {
      return {
        async innerText() { return "Page body"; },
        async allTextContents() { return ["Page body"]; },
      };
    },
    url() { return "https://example.com/"; },
    async title() { return "Example"; },
    async close() { this.closed = true; },
    ...overrides,
  };
}

function create_browser(overrides = {}) {
  const disconnected_listeners = [];
  const existing_page = create_page();
  const session_page = create_page();
  const context = {
    closed: false,
    new_page_calls: 0,
    pages() { return [existing_page]; },
    async newPage() {
      this.new_page_calls += 1;
      return session_page;
    },
    async close() { this.closed = true; },
  };
  const browser = {
    context,
    existing_page,
    session_page,
    closed: false,
    new_context_calls: 0,
    connected: true,
    contexts() { return [context]; },
    async newContext() {
      this.new_context_calls += 1;
      throw new Error("newContext must not be called");
    },
    isConnected() { return this.connected; },
    on(event, listener) {
      if (event === "disconnected") disconnected_listeners.push(listener);
    },
    disconnect() {
      this.connected = false;
      for (const listener of disconnected_listeners) listener();
    },
    async close() { this.closed = true; },
    ...overrides,
  };
  return browser;
}

test.beforeEach(() => {
  connect_calls.length = 0;
  current_browser = create_browser();
});

test("连接传递 timeout 和 noDefaults，并在默认 context 创建独占 page", async () => {
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "http://127.0.0.1:9222",
    timeout_ms: 4_000,
  });

  const result = await provider.create_session({ url: "https://example.com" });

  assert.deepEqual(connect_calls, [[
    "http://127.0.0.1:9222",
    { timeout: 4_000, noDefaults: true },
  ]]);
  assert.equal(current_browser.context.new_page_calls, 1);
  assert.equal(current_browser.new_context_calls, 0);
  assert.equal(current_browser.existing_page.closed, false);
  assert.equal(current_browser.session_page.default_timeout, 4_000);
  assert.equal(current_browser.session_page.default_navigation_timeout, 4_000);
  assert.deepEqual(current_browser.session_page.goto_calls, [[
    "https://example.com",
    { waitUntil: "domcontentloaded" },
  ]]);
  assert.equal(result.title, "Example");

  await provider.close_session({ session_id: result.session_id });
  assert.equal(current_browser.session_page.closed, true);
  assert.equal(current_browser.existing_page.closed, false);
  assert.equal(current_browser.context.closed, false);
});

test("默认 context 不存在时返回 resolve-context 且不创建隔离 context", async () => {
  current_browser = create_browser({ contexts: () => [] });
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "ws://user:password@127.0.0.1:9222/devtools/browser/id?token=secret",
  });

  await assert.rejects(
    provider.create_session({}),
    (error) => {
      assert.match(error.message, /during resolve-context/);
      assert.match(error.message, /ws:\/\/127\.0\.0\.1:9222/);
      assert.doesNotMatch(error.message, /user|password|token|browser\/id/);
      return true;
    },
  );
  assert.equal(current_browser.new_context_calls, 0);
});

test("page 创建失败时返回 create-page 且保留默认 context", async () => {
  current_browser = create_browser();
  current_browser.context.newPage = async () => {
    throw new Error(
      "Protocol error for ws://user:pass@127.0.0.1:9222/devtools/browser/private?token=secret",
    );
  };
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "ws://user:password@127.0.0.1:9222/devtools/browser/id?token=secret",
  });

  await assert.rejects(
    provider.create_session({}),
    (error) => {
      assert.match(error.message, /during create-page/);
      assert.match(error.message, /ws:\/\/127\.0\.0\.1:9222/);
      assert.doesNotMatch(error.message, /user|pass|token|private|browser\/id/);
      return true;
    },
  );
  assert.equal(current_browser.context.closed, false);
});

test("页面初始化失败时关闭新 page 并复用 browser connection", async () => {
  current_browser = create_browser();
  const first_page = current_browser.session_page;
  first_page.goto = async () => {
    throw new Error("Navigation failed for https://example.com/private?token=secret");
  };
  const second_page = create_page();
  current_browser.context.newPage = async () => {
    current_browser.context.new_page_calls += 1;
    return current_browser.context.new_page_calls === 1 ? first_page : second_page;
  };
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "http://127.0.0.1:9222",
  });

  await assert.rejects(
    provider.create_session({ url: "https://example.com/private" }),
    (error) => {
      assert.match(error.message, /during initialize-page/);
      assert.doesNotMatch(error.message, /private|token|secret/);
      return true;
    },
  );
  assert.equal(first_page.closed, true);

  const result = await provider.create_session({ url: "https://example.com" });
  assert.equal(connect_calls.length, 1);
  assert.equal(second_page.closed, false);
  await provider.close_session({ session_id: result.session_id });
});

test("连接失败返回脱敏 connect 错误", async () => {
  current_browser = new Error(
    "connect ECONNREFUSED ws://user:pass@127.0.0.1:9222/devtools/browser/id?token=secret",
  );
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "ws://user:password@127.0.0.1:9222/devtools/browser/id?token=secret",
  });

  await assert.rejects(
    provider.create_session({}),
    (error) => {
      assert.match(error.message, /during connect/);
      assert.match(error.message, /ws:\/\/127\.0\.0\.1:9222/);
      assert.doesNotMatch(error.message, /user|pass|token|secret|browser\/id/);
      return true;
    },
  );
});

test("browser disconnected 后清理 session registry", async () => {
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "http://127.0.0.1:9222",
  });
  const result = await provider.create_session({});

  current_browser.disconnect();

  await assert.rejects(
    provider.observe({ session_id: result.session_id }),
    /Browser session not found/,
  );
});

test("旧 browser 延迟断开不会清理新连接的 session", async () => {
  const first_browser = current_browser;
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "http://127.0.0.1:9222",
  });
  await provider.create_session({});

  first_browser.connected = false;
  current_browser = create_browser();
  const result = await provider.create_session({});
  first_browser.disconnect();

  const observation = await provider.observe({ session_id: result.session_id });
  assert.equal(observation.session_id, result.session_id);
  assert.equal(connect_calls.length, 2);
});

test("dispose 关闭 provider page 和 CDP connection，不关闭默认 context", async () => {
  const provider = new PlaywrightBrowserProvider({
    cdp_url: "http://127.0.0.1:9222",
  });
  await provider.create_session({});

  await provider.dispose();

  assert.equal(current_browser.session_page.closed, true);
  assert.equal(current_browser.existing_page.closed, false);
  assert.equal(current_browser.context.closed, false);
  assert.equal(current_browser.closed, true);
});
