/**
 * Memory / Web Power 宿主管理 actions 的行为测试。
 *
 * 关键点（中文）
 * - 界面 action 必须在界面选定的 Agent + Workspace 上调用本 Power 的领域 action，
 *   而不是自己读文件或直接持有 Provider。
 * - 快照只暴露脱敏配置：密钥字段本身不得出现在任何界面协议里。
 * - 领域失败必须还原为异常，不能被界面当成空数据。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryPower } from "@downcity/powers/memory";
import { WebPower } from "@downcity/powers/web";

/** 记录一次领域 action 调用。 */
function create_invocation_log() {
  return [];
}

/** 启动 Memory Power，并让宿主 system 记录领域调用。 */
async function start_memory_power(options = {}) {
  const actions = new Map();
  const invocations = create_invocation_log();
  const storage_root = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-memory-host-"));
  await new MemoryPower({ storage_root_path: storage_root }).initialize({
    power: {
      id: "memory",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    storage: { path: storage_root, files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      async list_agents() {
        return [
          { agent_id: "agent-a", name: "Agent A" },
          { agent_id: "agent-b", name: "Agent B" },
        ];
      },
      async list_workspaces() {
        return [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: storage_root }];
      },
      async invoke_agent_power(input) {
        invocations.push(input);
        return await (options.on_invoke?.(input) ?? { success: true, data: {} });
      },
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations, storage_root };
}

/** 启动 Web Power，并让宿主 system 记录领域调用。 */
async function start_web_power(options = {}) {
  const actions = new Map();
  const invocations = create_invocation_log();
  let stored_config = options.config ?? {};
  const power = new WebPower();
  power.initialize({
    power: {
      id: "web",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    config: {
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
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations };
}

test("Memory 界面 action 全部在选定执行范围上调用领域 action", async (context) => {
  const { actions, invocations, storage_root } = await start_memory_power({
    on_invoke: async (input) => {
      if (input.action_id === "status") {
        return {
          success: true,
          data: {
            provider: "builtin",
            state: "ready",
            capabilities: { list: true },
            details: { city_memory_available: false },
          },
        };
      }
      if (input.action_id === "list") {
        return { success: true, data: { provider: "builtin", items: [], total: 0, subject_counts: { agent: 0, user: 0, workspace: 0, city: 0 } } };
      }
      if (input.action_id === "read") {
        return { success: true, data: { memory_id: "agent/id_a/wiki/x", memory: null } };
      }
      if (input.action_id === "remember") {
        return { success: true, data: { memory_id: "agent/id_a/wiki/x", mode: "created" } };
      }
      if (input.action_id === "revise") {
        return { success: true, data: { memory_id: "agent/id_a/wiki/x", mode: "revised" } };
      }
      return { success: true, data: { memory_id: "agent/id_a/wiki/x", forgotten: true } };
    },
  });
  context.after(() => fs.rmSync(storage_root, { recursive: true, force: true }));
  const scope = { agent_id: "agent-a", workspace_id: "workspace-a" };

  const snapshot = await actions.get("memory.snapshot").run(scope);
  assert.deepEqual(snapshot.agents.map((agent) => agent.agent_id), ["agent-a", "agent-b"]);
  assert.equal(snapshot.status.provider, "builtin");
  assert.equal(snapshot.status.supports_list, true);

  await actions.get("memory.list").run({ ...scope, memory_types: ["fact"], include_evidence: true });
  await actions.get("memory.read").run({ ...scope, memory_id: "agent/id_a/wiki/x" });
  await actions.get("memory.remember").run({ ...scope, content: "x", target: "agent" });
  await actions.get("memory.revise").run({ ...scope, memory_id: "agent/id_a/wiki/x", instruction: "y" });
  await actions.get("memory.forget").run({ ...scope, memory_id: "agent/id_a/wiki/x" });

  // 每个领域调用都必须带上界面选定的 Agent 与 Workspace。
  const domain_calls = invocations.filter((item) => item.agent_id === "agent-a");
  assert.ok(domain_calls.length >= 7, "界面 action 没有把执行范围交给领域 action");
  for (const call of domain_calls) {
    assert.equal(call.power_id, "memory");
    assert.equal(call.workspace_id, "workspace-a");
  }
  const remember_call = invocations.find((item) => item.action_id === "remember");
  assert.deepEqual(remember_call.input, { content: "x", target: "agent" });
});

test("Memory 领域失败还原为异常，而不是空结果", async (context) => {
  const { actions, storage_root } = await start_memory_power({
    on_invoke: async (input) => input.action_id === "status"
      ? { success: true, data: { provider: "builtin", state: "ready", capabilities: { list: true } } }
      : { success: false, error: "Memory is outside the current access context" },
  });
  context.after(() => fs.rmSync(storage_root, { recursive: true, force: true }));
  await assert.rejects(
    () => actions.get("memory.read").run({
      agent_id: "agent-a",
      workspace_id: "workspace-a",
      memory_id: "city/users/id_x/wiki/secret",
    }),
    /outside the current access context/u,
  );
});

test("Memory 写入目标由界面传入，不被宿主 action 改写", async (context) => {
  const { actions, invocations, storage_root } = await start_memory_power({
    on_invoke: async (input) => input.action_id === "list"
      ? { success: true, data: { provider: "builtin", items: [], total: 0, subject_counts: { agent: 0, user: 0, workspace: 0, city: 0 } } }
      : { success: true, data: { memory_id: "city/users/id_a/wiki/x", mode: "created" } },
  });
  context.after(() => fs.rmSync(storage_root, { recursive: true, force: true }));
  await actions.get("memory.remember").run({
    agent_id: "agent-a",
    workspace_id: "workspace-a",
    content: "prefers concise answers",
    target: "current_user",
    memory_type: "preference",
  });
  const remember_call = invocations.find((item) => item.action_id === "remember");
  assert.equal(remember_call.input.target, "current_user");
  assert.equal(remember_call.input.memory_type, "preference");
});

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
  const scope = { agent_id: "agent-a", workspace_id: "workspace-a" };

  const snapshot = await actions.get("web.snapshot").run(scope);
  assert.equal(snapshot.search.available, true);
  assert.equal(snapshot.search.provider, "tavily");
  assert.equal(snapshot.document.available, true);
  assert.equal(snapshot.browser.available, true);
  assert.equal(snapshot.config.tavily_api_key_configured, true);
  // 状态页协议里绝不能出现密钥明文。
  assert.equal(JSON.stringify(snapshot).includes("secret-key"), false);

  const sessions = await actions.get("web.sessions").run(scope);
  assert.equal(sessions.available, true);
  assert.deepEqual(sessions.sessions, [{
    session_id: "s1",
    url: "https://example.com",
    title: "Example",
    observation_generation: 2,
  }]);
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
  const sessions = await actions.get("web.sessions").run({
    agent_id: "agent-a",
    workspace_id: "workspace-a",
  });
  assert.equal(sessions.available, false);
  assert.deepEqual(sessions.sessions, []);
  assert.match(sessions.note, /浏览器/u);
  // 浏览器不可用时不得再去调用浏览器领域 action。
  assert.equal(invocations.some((item) => item.action_id === "browser_list_sessions"), false);
});
