/** WebPower 配置与运行时上下文能力回归测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { WebPower } from "../bin/index.js";

/** 创建 WebPower Action 测试所需的最小完整上下文。 */
function create_context(workspace_id = "workspace-a", config = {}) {
  return {
    agent: { id: "agent-a" },
    workspace: { id: workspace_id, env: {} },
    storage: { path: "/tmp/downcity-web-power-test" },
    config,
  };
}

test("WebPower 允许空配置并暴露稳定 actions", () => {
  const power = new WebPower();
  assert.deepEqual(Object.keys(power.actions), [
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
  assert.deepEqual(power.availability(create_context()), {
    enabled: true,
    available: true,
    reasons: [],
  });
  assert.match(power.system(create_context()), /direct search or document reading/u);
  assert.match(power.system(create_context()), /browser actions/u);
});

test("browser_act schema 强制 ref 代次协议并保留显式 selector", () => {
  const schema = new WebPower().actions.browser_act.input_schema.zod;
  const payload = (action) => ({ session_id: "session-id", action });

  assert.equal(schema.safeParse(payload({ type: "click", ref: "e1" })).success, false);
  assert.equal(schema.safeParse(payload({
    type: "click",
    ref: "e1",
    selector: "button",
    observation_generation: 1,
  })).success, false);
  assert.equal(schema.safeParse(payload({ type: "click" })).success, false);
  assert.equal(schema.safeParse(payload({
    type: "click",
    ref: "e1",
    observation_generation: 1,
  })).success, true);
  assert.equal(schema.safeParse(payload({ type: "click", selector: "button" })).success, true);
});

test("配置读取不回显 API Key，空输入保留密钥，显式清除才删除", async () => {
  const config_actions = new Map();
  let stored_config = {
    search_provider: "tavily",
    document_provider: "fetch",
    browser_provider: "disabled",
    tavily_api_key: "secret-tavily-key",
  };
  const power = new WebPower();
  power.initialize({
    power: {
      id: "web",
      config_action(action) { config_actions.set(action.id, action); },
    },
    system: {},
  });
  const context = {
    config: {
      get() { return structuredClone(stored_config); },
      async set(next) { stored_config = structuredClone(next); },
    },
  };

  const read = await config_actions.get("config.read").run(undefined, context);
  assert.equal(read.tavily_api_key_configured, true);
  assert.equal("tavily_api_key" in read, false);

  const kept = await config_actions.get("config.save").run({
    ...read,
    tavily_api_key: "",
  }, context);
  assert.equal(stored_config.tavily_api_key, "secret-tavily-key");
  assert.equal("tavily_api_key" in kept, false);

  const cleared = await config_actions.get("config.save").run({
    ...kept,
    clear_tavily_api_key: true,
  }, context);
  assert.equal("tavily_api_key" in stored_config, false);
  assert.equal(cleared.tavily_api_key_configured, false);
  await power.dispose();
});

test("search 与 open 由 WebPower 自己拥有的 Provider 实现", async () => {
  const disposed = [];
  const power = new WebPower({
    search_provider: {
      name: "mock-search",
      async search(input) {
        return {
          provider: "mock-search",
          items: [{
            url: "https://example.com",
            title: input.query,
            snippet: null,
            score: null,
          }],
        };
      },
      async dispose() {
        disposed.push("search");
      },
    },
    document_provider: {
      name: "mock-reader",
      async open(input) {
        return {
          provider: "mock-reader",
          url: input.url,
          title: "Example",
          content: "Example content",
        };
      },
      async dispose() {
        disposed.push("document");
      },
    },
  });
  const search_result = await power.actions.search.execute({
    context: {},
    input: { query: "official docs" },
  });
  const open_result = await power.actions.open.execute({
    context: {},
    input: { url: "https://example.com" },
  });
  assert.equal(search_result.success, true);
  assert.equal(search_result.data.provider, "mock-search");
  assert.equal(open_result.success, true);
  assert.equal(open_result.data.content, "Example content");
  assert.equal(power.availability(create_context()).available, true);
  assert.match(power.system(create_context()), /direct search or document reading/u);
  await power.dispose();
  assert.deepEqual(disposed.sort(), ["document", "search"]);
});

test("浏览器 Provider 按 Agent 与 Workspace 作用域隔离并惰性复用", async () => {
  const created_scopes = [];
  const disposed_scopes = [];
  const power = new WebPower({
    browser_provider_factory(scope) {
      const scope_name = `${scope.agent_id}/${scope.workspace_id}`;
      created_scopes.push(scope_name);
      return {
        name: "mock-browser",
        async create_session() {
          return {
            provider: "mock-browser",
            session_id: scope_name,
            url: "about:blank",
            title: "",
            observation_generation: 1,
            accessibility_snapshot: "",
            text: "",
            elements: [],
            screenshot_data_url: null,
          };
        },
        async observe(input) {
          return {
            provider: "mock-browser",
            session_id: input.session_id,
            url: "about:blank",
            title: "",
            observation_generation: 1,
            accessibility_snapshot: "",
            text: "",
            elements: [],
            screenshot_data_url: null,
          };
        },
        async act(input) {
          return await this.observe(input);
        },
        async extract(input) {
          return {
            provider: "mock-browser",
            session_id: input.session_id,
            url: "about:blank",
            content: "",
          };
        },
        async close_session() {},
        async dispose() {
          disposed_scopes.push(scope_name);
        },
      };
    },
  });
  const context_a = create_context("workspace-a");
  const context_b = create_context("workspace-b");

  await Promise.all([
    power.actions.browser_create_session.execute({ context: context_a, input: {} }),
    power.actions.browser_create_session.execute({ context: context_a, input: {} }),
  ]);
  await power.actions.browser_create_session.execute({ context: context_b, input: {} });

  assert.deepEqual(created_scopes, ["agent-a/workspace-a", "agent-a/workspace-b"]);
  await power.dispose();
  assert.deepEqual(disposed_scopes.sort(), ["agent-a/workspace-a", "agent-a/workspace-b"]);
});

test("保存配置后释放旧浏览器 Provider，并在下一次调用惰性重建", async () => {
  const config_actions = new Map();
  let created_count = 0;
  let disposed_count = 0;
  const power = new WebPower({
    browser_provider_factory() {
      created_count += 1;
      return {
        name: "mock-browser",
        async create_session() {
          return {
            provider: "mock-browser",
            session_id: String(created_count),
            url: "about:blank",
            title: "",
            observation_generation: 1,
            accessibility_snapshot: "",
            text: "",
            elements: [],
            screenshot_data_url: null,
          };
        },
        async observe() { throw new Error("not used"); },
        async act() { throw new Error("not used"); },
        async extract() { throw new Error("not used"); },
        async close_session() {},
        async dispose() { disposed_count += 1; },
      };
    },
  });
  power.initialize({
    power: {
      id: "web",
      config_action(action) {
        config_actions.set(action.id, action);
      },
    },
    system: {},
  });
  const context = create_context();

  await power.actions.browser_create_session.execute({ context, input: {} });
  await config_actions.get("config.save").run(
    { timeout_ms: 5_000 },
    { config: { async set() {}, get() { return {}; } } },
  );
  assert.equal(disposed_count, 1);

  await power.actions.browser_create_session.execute({ context, input: {} });
  assert.equal(created_count, 2);
  await power.dispose();
  assert.equal(disposed_count, 2);
});

test("显式关闭搜索和浏览器时只让对应 action 失败", async () => {
  const power = new WebPower();
  const context = create_context("web-test-workspace", {
    search_provider: "disabled",
    browser_provider: "disabled",
  });
  const search_result = await power.actions.search.execute({
    context,
    input: { query: "test" },
  });
  const browser_result = await power.actions.browser_create_session.execute({
    context,
    input: { url: "https://example.com" },
  });
  assert.equal(search_result.success, false);
  assert.match(search_result.error, /not configured/u);
  assert.equal(browser_result.success, false);
  assert.match(browser_result.error, /not configured/u);
  await power.dispose();
});

test("WebPower 只接受公开的浏览器 provider 枚举", () => {
  assert.doesNotThrow(() => new WebPower({ config: { browser_provider: "cdp" } }));
  assert.throws(
    () => new WebPower({ config: { browser_provider: "unknown" } }),
    /Unsupported Web browser provider/u,
  );
});
