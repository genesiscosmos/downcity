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

  initialize() {
    this.events.push("initialize");
  }

  dispose() {
    this.events.push("dispose");
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
    scope_a.agent.sessions.create({ workspace: scope_a.workspace }),
    scope_b.agent.sessions.create({ workspace: scope_b.workspace }),
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
  assert.equal(events.filter((event) => event === "initialize").length, 1);

  await city.close();
  assert.equal(events.filter((event) => event === "dispose").length, 1);
});

test("City dynamically adds and removes one Plugin for every Agent", async () => {
  const events = [];
  const plugin = new ObservablePlugin(events);
  const scope = create_scope("dynamic");
  const city = new City({ workspaces: [scope.workspace], agents: [scope.agent] });
  await scope.agent.sessions.create({ workspace: scope.workspace });

  await city.plugins.add(plugin);
  await scope.agent.ensure_ready();
  assert.equal(city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).has(plugin.name), true);

  assert.equal(await city.plugins.remove(plugin.name), true);
  assert.equal(city.plugins.get(plugin.name), null);
  assert.deepEqual(events, ["initialize", "dispose"]);
  await city.close();
});

test("City creates a fresh PluginContext for every call", async () => {
  const contexts = [];
  const plugin = new ObservablePlugin([]);
  plugin.name = "fresh-context";
  plugin.actions = {
    inspect: create_action({
      execute: ({ context }) => {
        contexts.push(context);
        return {
          success: true,
          data: {
            agent_id: context.agent.id,
            workspace_id: context.workspace.id,
          },
        };
      },
    }),
  };
  const scope = create_scope("fresh-context");
  const city = new City({
    plugins: [plugin],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await scope.agent.sessions.create({ workspace: scope.workspace });
  const runtime = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  await runtime.run_action({ plugin: plugin.name, action: "inspect" });
  await runtime.run_action({ plugin: plugin.name, action: "inspect" });

  assert.equal(contexts.length, 2);
  assert.notEqual(contexts[0], contexts[1]);
  assert.equal(contexts[0].agent.id, scope.agent.id);
  assert.equal(contexts[1].workspace.id, scope.workspace.id);
  await city.close();
});

test("PluginContext captures one deeply immutable Config snapshot per call", async () => {
  let current_config = { nested: { value: "before" } };
  const observed_values = [];
  const plugin = new ObservablePlugin([]);
  plugin.name = "config-snapshot";
  plugin.availability = async (context) => {
    const first_config = context.config;
    current_config = { nested: { value: "after" } };
    const second_config = context.config;
    observed_values.push({
      same_reference: first_config === second_config,
      value: first_config.nested.value,
      nested_frozen: Object.isFrozen(first_config.nested),
    });
    assert.throws(() => {
      first_config.nested.value = "mutated";
    }, TypeError);
    return { enabled: true, available: true, reasons: [] };
  };
  const scope = create_scope("config-snapshot");
  const city = new City({
    plugins: [plugin],
    workspaces: [scope.workspace],
    agents: [scope.agent],
    plugin_host: {
      config: () => ({
        get: () => current_config,
        set: async (config) => {
          current_config = config;
        },
      }),
      notifications: () => ({ publish: async () => {}, dismiss: async () => {} }),
    },
  });
  await scope.agent.sessions.create({ workspace: scope.workspace });
  const runtime = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  await runtime.availability(plugin.name);

  assert.deepEqual(observed_values, [{
    same_reference: true,
    value: "before",
    nested_frozen: true,
  }]);
  assert.deepEqual(current_config, { nested: { value: "after" } });
  await city.close();
});

test("Agent removal does not own or dispose the City Plugin", async () => {
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
  await scope.agent.sessions.create({ workspace: scope.workspace });

  const action = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).run_action({ plugin: plugin.name, action: "wait" });
  await action_started;
  const removal = city.agents.remove(scope.agent.id);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["initialize", "action:start"]);
  release_action();
  await Promise.all([action, removal]);
  assert.deepEqual(events, ["initialize", "action:start", "action:finish"]);
  await city.close();
  assert.deepEqual(events.at(-1), "dispose");
});

test("City waits for a direct Plugin hook before disposing it", async () => {
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
  await scope.agent.sessions.create({ workspace: scope.workspace });
  const runtime = city.plugins.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  const hook = runtime.pipeline("wait", { ready: true });
  await hook_started;
  const removal = city.plugins.remove(plugin.name);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.includes("dispose"), false);
  release_hook();
  await Promise.all([hook, removal]);
  assert.deepEqual(events.slice(-2), ["hook:finish", "dispose"]);
  await city.close();
});

test("City rejects a second instance with the same Plugin ID", async () => {
  const city = new City({ plugins: [new ObservablePlugin([])] });
  await assert.rejects(city.plugins.add(new ObservablePlugin([])), {
    message: "Plugin already exists in City: observable",
  });
  await city.close();
});

test("City Plugin add exposes asynchronous initialization failure", async () => {
  const city = new City();
  const plugin = new ObservablePlugin([]);
  plugin.name = "broken-initialize";
  plugin.initialize = async () => {
    throw new Error("plugin-initialize-failed");
  };

  await assert.rejects(city.plugins.add(plugin), /plugin-initialize-failed/u);
  assert.equal(city.plugins.get(plugin.name), null);
  assert.deepEqual(city.plugins.snapshots().map(({ name, status, last_error }) => ({
    name,
    status,
    last_error,
  })), [{
    name: plugin.name,
    status: "error",
    last_error: "plugin-initialize-failed",
  }]);
  await assert.rejects(
    city.plugins.invoke(plugin.name, "missing"),
    /Plugin is unavailable in City: broken-initialize: plugin-initialize-failed/u,
  );
  await city.close();
});

test("City never publishes a Plugin whose initialization fails", async () => {
  const events = [];
  const plugin = new ObservablePlugin(events);
  plugin.name = "transactional";
  const scope_a = create_scope("transaction_a");
  const scope_b = create_scope("transaction_b");
  plugin.initialize = () => {
    events.push("initialize:failed");
    throw new Error("initialize-failed");
  };
  const city = new City({
    workspaces: [scope_a.workspace, scope_b.workspace],
    agents: [scope_a.agent, scope_b.agent],
  });
  await Promise.all([
    scope_a.agent.sessions.create({ workspace: scope_a.workspace }),
    scope_b.agent.sessions.create({ workspace: scope_b.workspace }),
  ]);

  await assert.rejects(city.plugins.add(plugin), /initialize-failed/u);

  assert.equal(city.plugins.get(plugin.name), null);
  assert.equal(city.plugins.snapshots()[0]?.status, "error");
  assert.equal(city.plugins.scope({
    agent_id: scope_a.agent.id,
    workspace_id: scope_a.workspace.id,
  }).has(plugin.name), false);
  assert.equal(city.plugins.scope({
    agent_id: scope_b.agent.id,
    workspace_id: scope_b.workspace.id,
  }).has(plugin.name), false);
  assert.deepEqual(events, ["initialize:failed", "dispose"]);
  await Promise.all([scope_a.agent.ensure_ready(), scope_b.agent.ensure_ready()]);

  plugin.initialize = () => {
    events.push("initialize:retry");
  };
  await city.plugins.add(plugin);
  assert.equal(city.plugins.get(plugin.name), plugin);
  assert.equal(city.plugins.snapshots()[0]?.status, "ready");
  await city.close();
});

test("City initializes one Plugin instance and disposes it on close", async () => {
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
      initialize(context) {
        events.push("initialize");
        context.plugin.action({ id: "ping", run: (input) => input ?? null });
      },
      dispose() {
        events.push("dispose");
      },
    },
  };
  const city = new City({ plugins: [registration] });

  assert.deepEqual(await Promise.all([
    city.plugins.invoke("main-test", "ping", { order: 1 }),
    city.plugins.invoke("main-test", "ping", { order: 2 }),
  ]), [{ order: 1 }, { order: 2 }]);
  assert.deepEqual(events, ["initialize"]);

  await city.close();
  assert.deepEqual(events, ["initialize", "dispose"]);
});

test("City waits for an active Plugin host action before disposal", async () => {
  const events = [];
  let release_action;
  const action_released = new Promise((resolve) => {
    release_action = resolve;
  });
  let mark_action_started;
  const action_started = new Promise((resolve) => {
    mark_action_started = resolve;
  });
  const city = new City({
    plugins: [{
      readme: import.meta.filename,
      has_config: false,
      has_sidebar: true,
      has_mainview: false,
      plugin: {
        name: "host-lease",
        title: "Host Lease",
        description: "Verifies host action lifecycle leases",
        initialize(context) {
          context.plugin.action({
            id: "wait",
            run: async () => {
              events.push("action:start");
              mark_action_started();
              await action_released;
              events.push("action:finish");
              return null;
            },
          });
        },
        dispose() {
          events.push("dispose");
        },
      },
    }],
  });

  const invocation = city.plugins.invoke("host-lease", "wait");
  await action_started;
  const removal = city.plugins.remove("host-lease");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["action:start"]);

  release_action();
  await Promise.all([invocation, removal]);
  assert.deepEqual(events, ["action:start", "action:finish", "dispose"]);
  await city.close();
});

test("City close immediately rejects new Plugin operations", async () => {
  const city = new City();
  const closing = city.close();

  assert.throws(
    () => city.plugins.add(new ObservablePlugin([])),
    /City Plugin Runtime is disposing/u,
  );
  await assert.rejects(
    city.plugins.remove("observable"),
    /City Plugin Runtime is disposing/u,
  );
  await closing;
});

test("City config actions use the Plugin-owned config store", async () => {
  const requests = [];
  const city = new City({
    plugin_host: {
      config(plugin_id) {
        requests.push(plugin_id);
        return {
          get: () => ({ token: "secret" }),
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
        initialize(context) {
          context.plugin.config_action({
            id: "read",
            run: async (_input, action_context) => await action_context.config.get(),
          });
        },
      },
    }],
  });

  assert.deepEqual(
    await city.plugins.invoke_config("config-main", "read"),
    { token: "secret" },
  );
  assert.deepEqual(requests, ["config-main"]);
  await city.close();
});
