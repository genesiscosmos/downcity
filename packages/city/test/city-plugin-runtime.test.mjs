/**
 * City Plugin 单实例、全 Agent 投影与生命周期测试。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "@downcity/agent";
import { City, Workspace } from "@downcity/city";
import { Plugin, create_action } from "@downcity/city/plugin";

/** 创建一个 Agent/Workspace 测试范围。 */
function create_scope(id) {
  return {
    agent: new Agent({ id: `agent_${id}` }),
    workspace: new Workspace({ id: `workspace_${id}`, path: process.cwd() }),
  };
}

class ObservablePlugin extends Plugin {
  name = "observable";
  title = "Observable";
  description = "Observes City lifecycle";

  constructor(events) {
    super();
    this.events = events;
  }

  start() {
    this.events.push("start");
  }

  connect(context) {
    this.events.push(`connect:${context.agent.id}:${context.workspace.id}`);
  }

  disconnect(context) {
    this.events.push(`disconnect:${context.agent.id}:${context.workspace.id}`);
  }

  stop() {
    this.events.push("stop");
  }

  actions = {
    scope: create_action({
      description: "Read the current execution scope.",
      execute: async ({ context }) => ({
        success: true,
        data: {
          agent_id: context.agent.id,
          workspace_id: context.workspace.id,
        },
      }),
    }),
  };
}

test("City owns one Plugin instance and exposes it to every Agent", async () => {
  const events = [];
  const plugin = new ObservablePlugin(events);
  const scope_a = create_scope("a");
  const scope_b = create_scope("b");
  const city = new City({
    plugins: [plugin],
    workspaces: [scope_a.workspace, scope_b.workspace],
    agents: [scope_a.agent, scope_b.agent],
  });

  await Promise.all([
    city.enter_workspace(scope_a.agent.id, scope_a.workspace.id),
    city.enter_workspace(scope_b.agent.id, scope_b.workspace.id),
  ]);
  const result_a = await city.plugins.scope({
    agent_id: scope_a.agent.id,
    workspace_id: scope_a.workspace.id,
  }).run_action({ plugin: plugin.name, action: "scope" });
  const result_b = await city.plugins.scope({
    agent_id: scope_b.agent.id,
    workspace_id: scope_b.workspace.id,
  }).run_action({ plugin: plugin.name, action: "scope" });

  assert.equal(city.plugins.get(plugin.name), plugin);
  assert.deepEqual(result_a.data, {
    agent_id: scope_a.agent.id,
    workspace_id: scope_a.workspace.id,
  });
  assert.deepEqual(result_b.data, {
    agent_id: scope_b.agent.id,
    workspace_id: scope_b.workspace.id,
  });
  assert.equal(events.filter((event) => event === "start").length, 1);

  await city.close();
  assert.equal(events.filter((event) => event.startsWith("connect:")).length, 2);
  assert.equal(events.filter((event) => event.startsWith("disconnect:")).length, 2);
  assert.equal(events.filter((event) => event === "stop").length, 1);
});

test("City dynamically adds and removes one Plugin for every Agent", async () => {
  const events = [];
  const plugin = new ObservablePlugin(events);
  const scope = create_scope("dynamic");
  const city = new City({ workspaces: [scope.workspace], agents: [scope.agent] });
  await city.enter_workspace(scope.agent.id, scope.workspace.id);

  city.plugins.add(plugin);
  await scope.agent.ensure_ready();
  assert.equal(city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).has(plugin.name), true);

  assert.equal(await city.plugins.remove(plugin.name), true);
  assert.equal(city.plugins.get(plugin.name), null);
  assert.deepEqual(events, [
    "start",
    `connect:${scope.agent.id}:${scope.workspace.id}`,
    `disconnect:${scope.agent.id}:${scope.workspace.id}`,
    "stop",
  ]);
  await city.close();
});

test("City waits for Agent Plugin execution before disconnecting its Workspace", async () => {
  const events = [];
  let release_action;
  const action_released = new Promise((resolve) => {
    release_action = resolve;
  });
  let mark_action_started;
  const action_started = new Promise((resolve) => {
    mark_action_started = resolve;
  });
  const plugin = new ObservablePlugin(events);
  plugin.actions = {
    wait: create_action({
      description: "Wait until the lifecycle assertion releases this action.",
      execute: async () => {
        events.push("action:start");
        mark_action_started();
        await action_released;
        events.push("action:finish");
        return { success: true, data: null };
      },
    }),
  };
  const scope = create_scope("detach");
  const city = new City({
    plugins: [plugin],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await city.enter_workspace(scope.agent.id, scope.workspace.id);

  const action = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).run_action({ plugin: plugin.name, action: "wait" });
  await action_started;
  const removal = city.agents.remove(scope.agent.id);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.some((event) => event.startsWith("disconnect:")), false);
  release_action();
  await Promise.all([action, removal]);
  assert.deepEqual(events.slice(-2), [
    "action:finish",
    `disconnect:${scope.agent.id}:${scope.workspace.id}`,
  ]);
  await city.close();
});

test("City waits for a direct Plugin hook before disconnecting and stopping it", async () => {
  const events = [];
  let release_hook;
  const hook_released = new Promise((resolve) => {
    release_hook = resolve;
  });
  let mark_hook_started;
  const hook_started = new Promise((resolve) => {
    mark_hook_started = resolve;
  });
  const plugin = new ObservablePlugin(events);
  plugin.hooks = {
    pipeline: {
      wait: [async ({ value }) => {
        events.push("hook:start");
        mark_hook_started();
        await hook_released;
        events.push("hook:finish");
        return value;
      }],
    },
  };
  const scope = create_scope("hook-removal");
  const city = new City({
    plugins: [plugin],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await city.enter_workspace(scope.agent.id, scope.workspace.id);
  const runtime = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  const hook = runtime.pipeline("wait", { ready: true });
  await hook_started;
  const removal = city.plugins.remove(plugin.name);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.some((event) => event.startsWith("disconnect:")), false);
  assert.equal(events.includes("stop"), false);
  release_hook();
  await Promise.all([hook, removal]);
  assert.deepEqual(events.slice(-3), [
    "hook:finish",
    `disconnect:${scope.agent.id}:${scope.workspace.id}`,
    "stop",
  ]);
  await city.close();
});

test("City rejects a second instance with the same Plugin ID", async () => {
  const city = new City({ plugins: [new ObservablePlugin([])] });
  assert.throws(() => city.plugins.add(new ObservablePlugin([])), {
    message: "Plugin already exists in City: observable",
  });
  await city.close();
});

test("City starts one Plugin instance and stops it on close", async () => {
  const events = [];
  const registration = {
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    plugin: {
      name: "main-test",
      title: "Main Test",
      description: "Verifies Plugin ownership",
      start(context) {
        events.push("start");
        context.plugin.action({ id: "ping", run: (input) => input ?? null });
      },
      stop() {
        events.push("stop");
      },
    },
  };
  const city = new City({ plugins: [registration] });

  assert.deepEqual(await Promise.all([
    city.plugins.invoke("main-test", "ping", { order: 1 }),
    city.plugins.invoke("main-test", "ping", { order: 2 }),
  ]), [{ order: 1 }, { order: 2 }]);
  assert.deepEqual(events, ["start"]);

  await city.close();
  assert.deepEqual(events, ["start", "stop"]);
});

test("City config actions use the requested Profile store", async () => {
  const requests = [];
  const city = new City({
    plugin_host: {
      profile_config(plugin_id, profile_id) {
        requests.push([plugin_id, profile_id]);
        return {
          get: async () => ({ token: "secret" }),
          set: async () => {},
        };
      },
      notifications: () => ({ publish: async () => {}, dismiss: async () => {} }),
    },
    plugins: [{
      readme: import.meta.filename,
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      plugin: {
        name: "config-main",
        title: "Config Main",
        description: "Verifies config actions",
        start(context) {
          context.plugin.config_action({
            id: "read",
            run: async (_input, action_context) => await action_context.config.get(),
          });
        },
      },
    }],
  });

  assert.deepEqual(
    await city.plugins.invoke_config("config-main", "profile-a", "read"),
    { token: "secret" },
  );
  assert.deepEqual(requests, [["config-main", "profile-a"]]);
  await city.close();
});
