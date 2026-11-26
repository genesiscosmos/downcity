/** Memory/Web 管理边界回归；新 Memory 内容协议由同目录合成集成测试覆盖。 */
import assert from "node:assert/strict";
import test from "node:test";
import { WebPower } from "@downcity/powers/web";

/** 启动 Web Power，并让宿主 system 记录领域调用。 */
async function start_web_power(options = {}) {
  const actions = new Map();
  const invocations = [];
  let stored_config = options.config ?? {};
  const power = new WebPower();
  await power.initialize({
    abort_signal: new AbortController().signal,
    power: {
      id: "web",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    config: {
      path: options.config_path ?? "/tmp/downcity/powers/web/config.toml",
      get() { return structuredClone(stored_config); },
      async set(next) { stored_config = structuredClone(next); },
    },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      async list_agents() {
        return [{ agent_id: "agent-a", name: "Agent A" }];
      },
      async list_workspaces() {
        return [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/tmp" }];
      },
      async invoke_agent_power(input) {
        invocations.push(input);
        return await (options.on_invoke?.(input) ?? { success: true, data: {} });
      },
      async open_external(input) { options.on_open_external?.(input); },
      async show_item_in_folder(input) { options.on_show_item_in_folder?.(input); },
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations };
}

test("Web 快照只返回脱敏配置，且浏览器会话来自领域 action", async () => {
  const { actions, invocations } = await start_web_power({
    config: {
      search_provider: "tavily",
      tavily_api_key: "secret-key",
      document_provider: "fetch",
      browser_provider: "local",
    },
    on_invoke: async (input) => input.action_id === "status"
      ? {
        success: true,
        data: {
          provider: "web",
          search_provider: "tavily",
          document_provider: "fetch",
          browser_provider: "local",
          available: true,
          reasons: [],
        },
      }
      : {
        success: true,
        data: {
          provider: "playwright-cdp",
          sessions: [{
            session_id: "s1",
            url: "https://example.com",
            title: "Example",
            observation_generation: 2,
          }],
        },
      },
  });
  // 配置是全局的：快照不再接收执行范围，内部自动选用第一个 Agent 与 Workspace。
  const snapshot = await actions.get("web.snapshot").run(undefined);
  assert.equal(snapshot.search.available, true);
  assert.equal(snapshot.search.provider, "tavily");
  assert.equal(snapshot.document.available, true);
  assert.equal(snapshot.browser.available, true);
  assert.equal(snapshot.config.tavily_api_key_configured, true);
  // 配置文件的真实路径由宿主告知，界面只展示与打开。
  assert.equal(snapshot.config_path, "/tmp/downcity/powers/web/config.toml");
  // 状态协议里绝不能出现密钥明文。
  assert.equal(JSON.stringify(snapshot).includes("secret-key"), false);

  const sessions = await actions.get("web.sessions").run(undefined);
  assert.equal(sessions.available, true);
  assert.deepEqual(sessions.sessions, [{
    session_id: "s1",
    url: "https://example.com",
    title: "Example",
    observation_generation: 2,
  }]);
  // 解析用的是宿主登记的第一个范围，而不是界面传入的值。
  for (const call of invocations) {
    assert.equal(call.agent_id, "agent-a");
    assert.equal(call.workspace_id, "workspace-a");
  }
  assert.deepEqual(invocations.map((item) => item.action_id), ["status", "status", "browser_list_sessions"]);
});

test("Web 浏览器关闭时明确报告不可用，而不是返回空列表", async () => {
  const { actions, invocations } = await start_web_power({
    config: { browser_provider: "disabled" },
    on_invoke: async () => ({
      success: true,
      data: {
        provider: "web",
        search_provider: "",
        document_provider: "fetch",
        browser_provider: "",
        available: true,
        reasons: [],
      },
    }),
  });
  const sessions = await actions.get("web.sessions").run(undefined);
  assert.equal(sessions.available, false);
  assert.deepEqual(sessions.sessions, []);
  assert.match(sessions.note, /浏览器/u);
  // 浏览器不可用时不得再去调用浏览器领域 action。
  assert.equal(invocations.some((item) => item.action_id === "browser_list_sessions"), false);
});

test("Web 配置文件的打开动作把路径交给宿主，没有路径时明确失败", async () => {
  const revealed = [];
  const { actions } = await start_web_power({
    config_path: "/tmp/downcity/powers/web/config.toml",
    on_show_item_in_folder: (input) => revealed.push(input.path),
  });

  const opened = await actions.get("web.config.reveal_file").run(undefined);
  assert.equal(opened.success, true);
  assert.deepEqual(revealed, ["/tmp/downcity/powers/web/config.toml"]);

  // 没有文件存储时不能编一个路径出来。
  const without_file = await start_web_power({ config_path: "" });
  const failed = await without_file.actions.get("web.config.reveal_file").run(undefined);
  assert.equal(failed.success, false);
  assert.match(failed.message, /文件/u);
});

test("Web 控制台跳转只接受已知凭据项，地址由服务端映射决定", async () => {
  const opened = [];
  const { actions } = await start_web_power({
    on_open_external: (input) => opened.push(input.url),
  });

  const result = await actions.get("web.config.open_console").run({ target: "tavily_api_key" });
  assert.equal(result.success, true);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\//u);

  // 渲染层不能借这个动作打开任意地址：只认枚举里的凭据项。
  await assert.rejects(
    () => actions.get("web.config.open_console").run({ target: "https://evil.example.com" }),
    /Unknown credential target/u,
  );
  assert.equal(opened.length, 1);
});

/** Ownership filters do not require a live executor for historical user records. */
