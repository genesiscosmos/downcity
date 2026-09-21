/**
 * City Power 单实例、全 Agent 投影与生命周期测试。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "@downcity/agent";
import { City, Workspace } from "@downcity/city";
import { Power, create_action } from "@downcity/city/power";

/** 用基类语义创建一个无隐藏生命周期的测试 Power。 */
function make_power(definition) {
  const { lifecycle, ...fields } = definition;
  class TestPower extends Power {
    name = definition.name;
  }
  return Object.assign(new TestPower(), fields, lifecycle || {});
}

/** 创建一个 Agent/Workspace 测试范围。 */
function create_scope(id) {
  return {
    agent: new Agent({ id: `agent_${id}` }),
    workspace: new Workspace({ id: `workspace_${id}`, path: process.cwd() }),
  };
}

class ObservablePower extends Power {
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

test("City owns one Power instance and exposes it to every Agent", async () => {
  const events = [];
  const power = new ObservablePower(events);
  const scope_a = create_scope("a");
  const scope_b = create_scope("b");
  const city = new City({
    powers: [power],
    workspaces: [scope_a.workspace, scope_b.workspace],
    agents: [scope_a.agent, scope_b.agent],
  });

  await Promise.all([
    scope_a.agent.sessions.create({ workspace: scope_a.workspace }),
    scope_b.agent.sessions.create({ workspace: scope_b.workspace }),
  ]);
  const result_a = await city.powers.scope({
    agent_id: scope_a.agent.id,
    workspace_id: scope_a.workspace.id,
  }).run_action({ power: power.name, action: "scope" });
  const result_b = await city.powers.scope({
    agent_id: scope_b.agent.id,
    workspace_id: scope_b.workspace.id,
  }).run_action({ power: power.name, action: "scope" });

  assert.equal(city.powers.get(power.name), power);
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

test("City dynamically adds and removes one Power for every Agent", async () => {
  const events = [];
  const power = new ObservablePower(events);
  const scope = create_scope("dynamic");
  const city = new City({ workspaces: [scope.workspace], agents: [scope.agent] });
  await scope.agent.sessions.create({ workspace: scope.workspace });

  await city.powers.add(power);
  await city.powers.settled();
  assert.equal(city.powers.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).has(power.name), true);

  assert.equal(await city.powers.remove(power.name), true);
  assert.equal(city.powers.get(power.name), null);
  assert.deepEqual(events, ["initialize", "dispose"]);
  await city.close();
});

test("City creates a fresh PowerContext for every call", async () => {
  const contexts = [];
  const power = new ObservablePower([]);
  power.name = "fresh-context";
  power.actions = {
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
    powers: [power],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await scope.agent.sessions.create({ workspace: scope.workspace });
  const runtime = city.powers.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  await runtime.run_action({ power: power.name, action: "inspect" });
  await runtime.run_action({ power: power.name, action: "inspect" });

  assert.equal(contexts.length, 2);
  assert.notEqual(contexts[0], contexts[1]);
  assert.equal(contexts[0].agent.id, scope.agent.id);
  assert.equal(contexts[1].workspace.id, scope.workspace.id);
  await city.close();
});

test("PowerContext captures one deeply immutable Config snapshot per call", async () => {
  let current_config = { nested: { value: "before" } };
  const observed_values = [];
  const power = new ObservablePower([]);
  power.name = "config-snapshot";
  power.availability = async (context) => {
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
    powers: [power],
    workspaces: [scope.workspace],
    agents: [scope.agent],
    power_host: {
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
  const runtime = city.powers.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  await runtime.availability(power.name);

  assert.deepEqual(observed_values, [{
    same_reference: true,
    value: "before",
    nested_frozen: true,
  }]);
  assert.deepEqual(current_config, { nested: { value: "after" } });
  await city.close();
});

test("Agent removal does not own or dispose the City Power", async () => {
  const events = [];
  let release_action;
  const action_released = new Promise((resolve) => {
    release_action = resolve;
  });
  let mark_action_started;
  const action_started = new Promise((resolve) => {
    mark_action_started = resolve;
  });
  const power = new ObservablePower(events);
  power.actions = {
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
    powers: [power],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await scope.agent.sessions.create({ workspace: scope.workspace });

  const action = city.powers.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  }).run_action({ power: power.name, action: "wait" });
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

test("City 移除 Power 时不再等待进行中的 hook", async () => {
  const events = [];
  let release_hook;
  const hook_released = new Promise((resolve) => {
    release_hook = resolve;
  });
  let mark_hook_started;
  const hook_started = new Promise((resolve) => {
    mark_hook_started = resolve;
  });
  const power = new ObservablePower(events);
  power.hooks = {
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
    powers: [power],
    workspaces: [scope.workspace],
    agents: [scope.agent],
  });
  await scope.agent.sessions.create({ workspace: scope.workspace });
  const runtime = city.powers.scope({
    agent_id: scope.agent.id,
    workspace_id: scope.workspace.id,
  });

  const hook = runtime.pipeline("wait", { ready: true });
  await hook_started;

  // 关键点（中文）：新契约下移除立即收口，不再持有 execution lease；
  // 已经在执行的 hook 自行跑完，City 不等待它。
  await city.powers.remove(power.name);
  assert.equal(city.powers.get(power.name), null);
  assert.equal(events.includes("dispose"), true);

  release_hook();
  await hook;
  assert.equal(events.includes("hook:finish"), true);
  await city.close();
});

test("City rejects a second instance with the same Power ID", async () => {
  const city = new City({ powers: [new ObservablePower([])] });
  await assert.rejects(city.powers.add(new ObservablePower([])), {
    message: "Power already exists in City: observable",
  });
  await city.close();
});

test("City Power add exposes asynchronous initialization failure", async () => {
  const city = new City();
  const power = new ObservablePower([]);
  power.name = "broken-initialize";
  power.initialize = async () => {
    throw new Error("power-initialize-failed");
  };

  await assert.rejects(city.powers.add(power), /power-initialize-failed/u);
  assert.equal(city.powers.get(power.name), null);
  assert.deepEqual(city.powers.snapshots()
    .filter((snapshot) => snapshot.name === power.name)
    .map(({ name, status, last_error }) => ({ name, status, last_error })), [{
    name: power.name,
    status: "error",
    last_error: "power-initialize-failed",
  }]);
  await assert.rejects(
    city.powers.invoke(power.name, "missing"),
    /Power is unavailable in City: broken-initialize: power-initialize-failed/u,
  );
  await city.close();
});

test("City never publishes a Power whose initialization fails", async () => {
  const events = [];
  const power = new ObservablePower(events);
  power.name = "transactional";
  const scope_a = create_scope("transaction_a");
  const scope_b = create_scope("transaction_b");
  power.initialize = () => {
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

  await assert.rejects(city.powers.add(power), /initialize-failed/u);

  assert.equal(city.powers.get(power.name), null);
  assert.equal(
    city.powers.snapshots().find((snapshot) => snapshot.name === power.name)?.status,
    "error",
  );
  assert.equal(city.powers.scope({
    agent_id: scope_a.agent.id,
    workspace_id: scope_a.workspace.id,
  }).has(power.name), false);
  assert.equal(city.powers.scope({
    agent_id: scope_b.agent.id,
    workspace_id: scope_b.workspace.id,
  }).has(power.name), false);
  assert.deepEqual(events, ["initialize:failed", "dispose"]);
  await city.powers.settled();

  power.initialize = () => {
    events.push("initialize:retry");
  };
  await city.powers.add(power);
  assert.equal(city.powers.get(power.name), power);
  assert.equal(
    city.powers.snapshots().find((snapshot) => snapshot.name === power.name)?.status,
    "ready",
  );
  await city.close();
});

test("City initializes one Power instance and disposes it on close", async () => {
  const events = [];
  const registration = {
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    power: make_power({
      name: "main-test",
      title: "Main Test",
      description: "Verifies Power ownership",
      initialize(context) {
        events.push("initialize");
        context.power.action({ id: "ping", run: (input) => input ?? null });
      },
      dispose() {
        events.push("dispose");
      },
    }),
  };
  const city = new City({ powers: [registration] });

  assert.deepEqual(await Promise.all([
    city.powers.invoke("main-test", "ping", { order: 1 }),
    city.powers.invoke("main-test", "ping", { order: 2 }),
  ]), [{ order: 1 }, { order: 2 }]);
  assert.deepEqual(events, ["initialize"]);

  await city.close();
  assert.deepEqual(events, ["initialize", "dispose"]);
});

test("City waits for an active Power host action before disposal", async () => {
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
    powers: [{
      readme: import.meta.filename,
      has_config: false,
      has_sidebar: true,
      has_mainview: false,
      power: make_power({
        name: "host-lease",
        title: "Host Lease",
        description: "Verifies host action lifecycle leases",
        initialize(context) {
          context.power.action({
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
      }),
    }],
  });

  const invocation = city.powers.invoke("host-lease", "wait");
  await action_started;
  const removal = city.powers.remove("host-lease");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["action:start"]);

  release_action();
  await Promise.all([invocation, removal]);
  assert.deepEqual(events, ["action:start", "action:finish", "dispose"]);
  await city.close();
});

test("City close immediately rejects new Power operations", async () => {
  const city = new City();
  const closing = city.close();

  assert.throws(
    () => city.powers.add(new ObservablePower([])),
    /City Power Runtime is disposing/u,
  );
  await assert.rejects(
    city.powers.remove("observable"),
    /City Power Runtime is disposing/u,
  );
  await closing;
});

test("City config actions use the Power-owned config store", async () => {
  const requests = [];
  const city = new City({
    power_host: {
      config(power_id) {
        requests.push(power_id);
        return {
          get: () => ({ token: "secret" }),
          set: async () => {},
        };
      },
      notifications: () => ({ publish: async () => {}, dismiss: async () => {} }),
    },
    powers: [{
      readme: import.meta.filename,
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      power: make_power({
        name: "config-main",
        title: "Config Main",
        description: "Verifies config actions",
        initialize(context) {
          context.power.config_action({
            id: "read",
            run: async (_input, action_context) => await action_context.config.get(),
          });
        },
      }),
    }],
  });

  assert.deepEqual(
    await city.powers.invoke_config("config-main", "read"),
    { token: "secret" },
  );
  assert.deepEqual(requests.filter((id) => id !== "city" && id !== "shell"), ["config-main"]);
  await city.close();
});
