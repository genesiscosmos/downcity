/**
 * Chat channel 构造配置公开行为测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ChatPlugin } from "../bin/index.js";

function create_channel(name) {
  return {
    name,
    isEnabled: () => false,
    get_channel_id: () => "",
    getAccount: () => null,
  };
}

/** 创建 Chat 生命周期测试使用的最小 PluginContext。 */
function create_context(plugin, agent_id, workspace_id, config = {}) {
  return {
    city: {
      plugins: {
        get: (plugin_id) => plugin_id === "chat" ? plugin : null,
      },
    },
    agent: { id: agent_id, name: agent_id, description: "", instructions: [], sessions: {} },
    workspace: { id: workspace_id, path: process.cwd(), files: {}, env: {} },
    config,
    storage: { path: process.cwd(), files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    abort_signal: new AbortController().signal,
  };
}

test("ChatPlugin 配置只来自 constructor", () => {
  const telegram = create_channel("telegram");
  const queue = { max_concurrency: 7, merge_debounce_ms: 123 };
  const plugin = new ChatPlugin({ queue, channels: [telegram] });

  assert.equal(plugin.channels[0], telegram);
  assert.deepEqual(plugin.getQueueWorkerConfig(create_context(plugin, "agent", "workspace")), queue);
});

test("ChatPlugin 不提供配置修改 action", () => {
  const plugin = new ChatPlugin({ channels: [] });

  assert.equal("open" in plugin.actions, false);
  assert.equal("close" in plugin.actions, false);
  assert.equal("configuration" in plugin.actions, false);
  assert.equal("configure" in plugin.actions, false);
});

test("ChatPlugin 消费 City 按 Agent 投影的渠道配置", () => {
  const plugin = new ChatPlugin();
  const context = create_context(plugin, "agent", "workspace", {
    channels: [{
      type: "telegram",
      id: "telegram-main",
      name: "main bot",
      bot_token: "token",
    }],
  });

  assert.equal(plugin.get_channel_id(context, "telegram"), "telegram-main");
  const account = plugin.resolveChannelAccount(context, "telegram");
  assert.ok(account);
  assert.deepEqual(account, {
    id: "telegram-main",
    channel: "telegram",
    name: "main bot",
    bot_token: "token",
    created_at: account.created_at,
    updated_at: account.updated_at,
  });
});

test("ChatPlugin 唯一实例为多个 Agent/Workspace 隔离运行态", async () => {
  const plugin = new ChatPlugin({ channels: [] });
  const first = create_context(plugin, "agent-a", "workspace-a");
  const second = create_context(plugin, "agent-b", "workspace-b");

  await plugin.lifecycle.connect(first);
  const queue_store = plugin.queue_store(first);
  await plugin.lifecycle.connect(second);
  assert.notEqual(plugin.queue_store(second), queue_store);
  await plugin.lifecycle.disconnect(first);
  assert.throws(() => plugin.queue_store(first), /not bound/);
  assert.ok(plugin.queue_store(second));
  await plugin.lifecycle.disconnect(second);
});

test("Chat 配置使用显式 Owner 忽略其他 Agent 作用域", async () => {
  const plugin = new ChatPlugin({
    owner_agent_id: "agent-owner",
    owner_workspace_id: "workspace-owner",
    channels: [],
  });
  const other = create_context(plugin, "agent-other", "workspace-other");
  const owner = create_context(plugin, "agent-owner", "workspace-owner");

  await plugin.lifecycle.connect(other);
  assert.throws(() => plugin.queue_store(other), /not bound/);
  await plugin.lifecycle.connect(owner);
  assert.ok(plugin.queue_store(owner));
  await plugin.lifecycle.stop();
});
