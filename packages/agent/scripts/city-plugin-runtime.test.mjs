/**
 * City Plugin 共享实例、Profile 与 execution lease 生命周期测试。
 *
 * 这些测试只验证 City 的所有权不变量，不依赖具体官方 Plugin 实现。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Agent, City } from "../bin/index.js";
import { create_workspace_entry } from "../bin/internal/index.js";
import { Workspace } from "@downcity/workspace";

/** 创建可观察生命周期的 City Plugin 注册。 */
function create_registration(observation) {
  const module = {
    activate() {},
    create({ profile }) {
      observation.creates.push(profile.id);
      return {
        name: "shared-test",
        title: "Shared Test",
        description: "Verifies City Plugin ownership",
        lifecycle: {
          start() {
            observation.starts.push(profile.id);
          },
          stop() {
            observation.stops.push(profile.id);
          },
        },
      };
    },
  };
  return {
    id: "shared-test",
    title: "Shared Test",
    description: "Verifies City Plugin ownership",
    readme: import.meta.filename,
    has_config: true,
    has_sidebar: false,
    has_mainview: false,
    module,
  };
}

/** 创建测试 Agent 与 Workspace。 */
function create_scope(id) {
  return {
    agent: new Agent({ id: `agent_${id}` }),
    workspace: new Workspace({ id: `workspace_${id}`, path: process.cwd() }),
  };
}

test("City shares one Plugin instance for the same profile across Agents", async () => {
  const observation = { creates: [], starts: [], stops: [] };
  const registration = create_registration(observation);
  const scope_a = create_scope("a");
  const scope_b = create_scope("b");
  const city = new City({
    workspaces: [scope_a.workspace, scope_b.workspace],
    plugins: [registration],
  });
  const binding = { plugin_id: registration.id, profile: { id: "team", config: { order: 1 } } };

  city.agents.add(scope_a.agent, { plugins: [binding] });
  city.agents.add(scope_b.agent, { plugins: [binding] });
  await Promise.all([scope_a.agent.ensure_ready(), scope_b.agent.ensure_ready()]);

  assert.deepEqual(observation.creates, ["team"]);
  assert.deepEqual(observation.starts, ["team"]);
  assert.equal(city.plugins.get(scope_a.agent.id, registration.id), city.plugins.get(scope_b.agent.id, registration.id));

  await city.agents.remove(scope_a.agent.id);
  assert.deepEqual(observation.stops, []);
  await city.agents.remove(scope_b.agent.id);
  assert.deepEqual(observation.stops, ["team"]);
  await city.close();
});

test("City creates independent Plugin instances for different profiles", async () => {
  const observation = { creates: [], starts: [], stops: [] };
  const registration = create_registration(observation);
  const scope_a = create_scope("profile_a");
  const scope_b = create_scope("profile_b");
  const city = new City({
    workspaces: [scope_a.workspace, scope_b.workspace],
    plugins: [registration],
  });

  city.agents.add(scope_a.agent, { plugins: [{ plugin_id: registration.id, profile: { id: "a", config: {} } }] });
  city.agents.add(scope_b.agent, { plugins: [{ plugin_id: registration.id, profile: { id: "b", config: {} } }] });
  await Promise.all([scope_a.agent.ensure_ready(), scope_b.agent.ensure_ready()]);

  assert.deepEqual(observation.creates.sort(), ["a", "b"]);
  assert.deepEqual(observation.starts.sort(), ["a", "b"]);
  assert.notEqual(city.plugins.get(scope_a.agent.id, registration.id), city.plugins.get(scope_b.agent.id, registration.id));
  await city.close();
  assert.deepEqual(observation.stops.sort(), ["a", "b"]);
});

test("City waits for the active execution lease before stopping the last shared instance", async () => {
  const observation = { creates: [], starts: [], stops: [] };
  const registration = create_registration(observation);
  const scope = create_scope("lease");
  const city = new City({ workspaces: [scope.workspace], plugins: [registration] });
  city.agents.add(scope.agent, { plugins: [{ plugin_id: registration.id }] });
  await scope.agent.ensure_ready();
  const entry = create_workspace_entry(scope.agent, scope.workspace);
  const lease = await entry.get_session_context().get_extensions().acquire();

  let settled = false;
  const unregister_promise = city.plugins.unregister(scope.agent.id, registration.id)
    .finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.deepEqual(observation.stops, []);

  await lease.release();
  assert.equal(await unregister_promise, true);
  assert.deepEqual(observation.stops, ["default"]);
  await city.close();
});

test("City binds and unbinds each Agent Workspace scope exactly once", async () => {
  const scopes = [];
  const registration = {
    id: "scope-test",
    title: "Scope Test",
    description: "Verifies Workspace lifecycle",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    module: {
      activate() {},
      create: () => ({
        name: "scope-test",
        title: "Scope Test",
        description: "Verifies Workspace lifecycle",
        lifecycle: {
          bind(context) {
            scopes.push(`bind:${context.agent.id}:${context.workspace.id}`);
          },
          unbind(context) {
            scopes.push(`unbind:${context.agent.id}:${context.workspace.id}`);
          },
        },
      }),
    },
  };
  const scope = create_scope("workspace_lifecycle");
  const city = new City({ workspaces: [scope.workspace], plugins: [registration] });
  city.agents.add(scope.agent, { plugins: [{ plugin_id: registration.id }] });
  const entry = create_workspace_entry(scope.agent, scope.workspace);

  await entry.get_session_context().get_extensions().system_blocks();
  await entry.get_session_context().get_extensions().system_blocks();
  assert.deepEqual(scopes, [
    "bind:agent_workspace_lifecycle:workspace_workspace_lifecycle",
  ]);

  await entry.leave();
  assert.deepEqual(scopes, [
    "bind:agent_workspace_lifecycle:workspace_workspace_lifecycle",
    "unbind:agent_workspace_lifecycle:workspace_workspace_lifecycle",
  ]);
  await city.close();
});

test("City dynamically binds, replaces, and unbinds only the target Plugin scope", async () => {
  const events = [];
  const create_registration = (plugin_id) => ({
    id: plugin_id,
    title: plugin_id,
    description: `Verifies dynamic scope lifecycle for ${plugin_id}`,
    readme: import.meta.filename,
    has_config: true,
    has_sidebar: false,
    has_mainview: false,
    module: {
      activate() {},
      create: ({ profile }) => ({
        name: plugin_id,
        title: plugin_id,
        description: plugin_id,
        lifecycle: {
          start: () => events.push(`start:${plugin_id}:${profile.id}`),
          bind: (context) => events.push(`bind:${plugin_id}:${profile.id}:${context.workspace.id}`),
          unbind: (context) => events.push(`unbind:${plugin_id}:${profile.id}:${context.workspace.id}`),
          stop: () => events.push(`stop:${plugin_id}:${profile.id}`),
        },
      }),
    },
  });
  const stable_registration = create_registration("stable-scope");
  const dynamic_registration = create_registration("dynamic-scope");
  const scope = create_scope("dynamic_scope");
  const city = new City({
    workspaces: [scope.workspace],
    plugins: [stable_registration, dynamic_registration],
  });
  city.agents.add(scope.agent, {
    plugins: [{ plugin_id: stable_registration.id, profile: { id: "stable", config: {} } }],
  });
  const entry = create_workspace_entry(scope.agent, scope.workspace);
  await entry.get_session_context().get_extensions().system_blocks();

  await city.plugins.register(scope.agent.id, {
    plugin_id: dynamic_registration.id,
    profile: { id: "first", config: {} },
  });
  await city.plugins.register(scope.agent.id, {
    plugin_id: dynamic_registration.id,
    profile: { id: "second", config: {} },
  });
  assert.equal(await city.plugins.unregister(scope.agent.id, dynamic_registration.id), true);

  assert.deepEqual(events, [
    "start:stable-scope:stable",
    `bind:stable-scope:stable:${scope.workspace.id}`,
    "start:dynamic-scope:first",
    `bind:dynamic-scope:first:${scope.workspace.id}`,
    `unbind:dynamic-scope:first:${scope.workspace.id}`,
    "stop:dynamic-scope:first",
    "start:dynamic-scope:second",
    `bind:dynamic-scope:second:${scope.workspace.id}`,
    `unbind:dynamic-scope:second:${scope.workspace.id}`,
    "stop:dynamic-scope:second",
  ]);

  await entry.leave();
  await city.close();
  assert.deepEqual(events.slice(-2), [
    `unbind:stable-scope:stable:${scope.workspace.id}`,
    "stop:stable-scope:stable",
  ]);
});

test("City execution projection preserves class methods without exposing lifecycle", async () => {
  class ClassPlugin {
    name = "class-test";
    title = "Class Test";
    description = "Verifies execution projection";
    lifecycle = { start() {} };
    read_identity() {
      return this.name;
    }
  }
  const registration = {
    id: "class-test",
    title: "Class Test",
    description: "Verifies execution projection",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    module: { activate() {}, create: () => new ClassPlugin() },
  };
  const scope = create_scope("class_projection");
  const city = new City({ workspaces: [scope.workspace], plugins: [registration] });
  city.agents.add(scope.agent, { plugins: [{ plugin_id: registration.id }] });
  await scope.agent.ensure_ready();

  const plugin = city.plugins.get(scope.agent.id, registration.id);
  assert.equal(plugin.read_identity(), "class-test");
  assert.equal(plugin.lifecycle, undefined);
  assert.equal("lifecycle" in plugin, false);
  await city.close();
});

test("City owns one main activation and deactivation for all Plugin profiles", async () => {
  const events = [];
  const registration = {
    id: "main-test",
    title: "Main Test",
    description: "Verifies City main ownership",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    module: {
      activate(context) {
        events.push("activate");
        context.plugin.action({
          id: "ping",
          run: (input) => ({ input }),
        });
      },
      deactivate() {
        events.push("deactivate");
      },
      create: () => ({
        name: "main-test",
        title: "Main Test",
        description: "Verifies City main ownership",
      }),
    },
  };
  const scope_a = create_scope("main_a");
  const scope_b = create_scope("main_b");
  const city = new City({ workspaces: [scope_a.workspace, scope_b.workspace] });
  city.plugins.provide(registration);
  city.agents.add(scope_a.agent, { plugins: [{ plugin_id: registration.id, profile: { id: "a", config: {} } }] });
  city.agents.add(scope_b.agent, { plugins: [{ plugin_id: registration.id, profile: { id: "b", config: {} } }] });

  assert.deepEqual(
    await city.plugins.invoke("main-test", "ping", { value: 1 }),
    { input: { value: 1 } },
  );
  await Promise.all([scope_a.agent.ensure_ready(), scope_b.agent.ensure_ready()]);
  assert.deepEqual(events, ["activate"]);
  await city.close();
  assert.deepEqual(events, ["activate", "deactivate"]);
});

test("City validates catalog conflicts and activates concurrent main calls once", async () => {
  let activation_count = 0;
  const registration = {
    id: "concurrent-main",
    title: "Concurrent Main",
    description: "Verifies concurrent activation",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    module: {
      async activate(context) {
        activation_count += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        context.plugin.action({ id: "ping", run: (input) => input ?? null });
      },
      create: () => ({
        name: "concurrent-main",
        title: "Concurrent Main",
        description: "Concurrent Main",
      }),
    },
  };
  const city = new City();
  city.plugins.provide(registration);
  assert.throws(() => city.plugins.provide({ ...registration, module: { ...registration.module } }), {
    message: "Plugin module conflicts in City catalog: concurrent-main",
  });

  assert.deepEqual(await Promise.all([
    city.plugins.invoke(registration.id, "ping", { order: 1 }),
    city.plugins.invoke(registration.id, "ping", { order: 2 }),
  ]), [{ order: 1 }, { order: 2 }]);
  assert.equal(activation_count, 1);
  await city.close();
});

test("City retries failed main activation and rejects non-JSON action results", async () => {
  let activation_count = 0;
  const registration = {
    id: "retry-main",
    title: "Retry Main",
    description: "Verifies failed activation cleanup",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    module: {
      activate(context) {
        activation_count += 1;
        if (activation_count === 1) throw new Error("activation failed");
        context.plugin.action({ id: "invalid", run: () => 1n });
      },
      create: () => ({ name: "retry-main", title: "Retry Main", description: "Retry Main" }),
    },
  };
  const city = new City();
  city.plugins.provide(registration);
  await assert.rejects(city.plugins.invoke(registration.id, "invalid"), /activation failed/);
  await assert.rejects(city.plugins.invoke(registration.id, "invalid"), /not JSON-serializable/);
  assert.equal(activation_count, 2);
  await city.close();
});

test("City config actions use the requested Profile store", async () => {
  const profile_requests = [];
  const profile_values = new Map([["profile-a", { token: "secret" }]]);
  const city = new City({
    plugin_host: {
      profile_config(plugin_id, profile_id) {
        profile_requests.push([plugin_id, profile_id]);
        return {
          get: async () => profile_values.get(profile_id) ?? {},
          set: async (config) => { profile_values.set(profile_id, config); },
        };
      },
      notifications: () => ({ publish: async () => {}, dismiss: async () => {} }),
    },
  });
  const registration = {
    id: "config-main",
    title: "Config Main",
    description: "Verifies Profile config actions",
    readme: import.meta.filename,
    has_config: true,
    has_sidebar: false,
    has_mainview: false,
    module: {
      activate(context) {
        context.plugin.config_action({
          id: "read",
          run: async (_input, action_context) => await action_context.config.get(),
        });
      },
      create: () => ({ name: "config-main", title: "Config Main", description: "Config Main" }),
    },
  };
  city.plugins.provide(registration);

  assert.deepEqual(
    await city.plugins.invoke_config(registration.id, "profile-a", "read"),
    { token: "secret" },
  );
  assert.deepEqual(profile_requests, [[registration.id, "profile-a"]]);
  await city.close();
});

test("City deactivates every main when one Plugin cleanup fails", async () => {
  const events = [];
  const registration = (plugin_id, should_fail) => ({
    id: plugin_id,
    title: plugin_id,
    description: plugin_id,
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: true,
    has_mainview: true,
    module: {
      activate(context) {
        context.plugin.action({ id: "ping", run: () => null });
      },
      deactivate() {
        events.push(plugin_id);
        if (should_fail) throw new Error(`failed:${plugin_id}`);
      },
      create: () => ({ name: plugin_id, title: plugin_id, description: plugin_id }),
    },
  });
  const city = new City();
  const first = registration("cleanup-first", true);
  const second = registration("cleanup-second", false);
  city.plugins.provide(first);
  city.plugins.provide(second);
  await Promise.all([
    city.plugins.invoke(first.id, "ping"),
    city.plugins.invoke(second.id, "ping"),
  ]);

  await assert.rejects(city.close(), /City transport close failed/);
  assert.deepEqual(events.sort(), [first.id, second.id].sort());
});
