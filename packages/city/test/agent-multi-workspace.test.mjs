/** 验证一个 Agent 可以进入多个 Workspace，且 Plugin Context 与生命周期彼此隔离。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@downcity/agent";
import { City } from "../bin/index.js";
import { create_plugin } from "@downcity/plugin";
import { create_workspace_entry, get_workspace_entry } from "@downcity/agent/host";
import { Workspace } from "@downcity/workspace";
import {
  create_plugin_binding,
  create_plugin_registration,
} from "./helpers/CityPluginTestBinding.mjs";

test("one Agent enters multiple Workspaces with contextual Plugin execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-workspaces-"));
  const lifecycle_events = [];
  const contexts = [];
  const plugin = create_plugin({
    name: "context_probe",
    title: "Context Probe",
    description: "Records the current Workspace Context.",
    lifecycle: {
      start: ({ profile }) => lifecycle_events.push(`start:${profile.id}`),
      stop: ({ profile }) => lifecycle_events.push(`stop:${profile.id}`),
    },
    actions: {
      inspect: {
        description: "Read the current Workspace Context.",
        execute: ({ context }) => {
          contexts.push({
            agent_id: context.agent.id,
            workspace_id: context.workspace.id,
            workspace_path: context.workspace.path,
            data_path: context.storage.path,
          });
          return { success: true, data: contexts.at(-1) };
        },
      },
    },
  });
  await Promise.all([
    fs.mkdir(path.join(root, "sdk")),
    fs.mkdir(path.join(root, "homepage")),
  ]);
  const agent = new Agent({ id: "coder" });
  const first_workspace = new Workspace({
    id: "sdk",
    path: path.join(root, "sdk"),
    data_root_path: path.join(root, "data"),
  });
  const second_workspace = new Workspace({
    id: "homepage",
    path: path.join(root, "homepage"),
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [first_workspace, second_workspace] });
  city.agents.add(agent, { plugins: [create_plugin_binding(city, plugin)] });
  const first = create_workspace_entry(agent, first_workspace);
  const second = create_workspace_entry(agent, second_workspace);

  try {
    const [first_result, second_result] = await Promise.all([
      first.plugins.run_action({ plugin: "context_probe", action: "inspect" }),
      second.plugins.run_action({ plugin: "context_probe", action: "inspect" }),
    ]);
    assert.equal(first_result.data.workspace_id, "sdk");
    assert.equal(second_result.data.workspace_id, "homepage");
    assert.deepEqual(new Set(contexts.map((item) => item.workspace_id)), new Set(["sdk", "homepage"]));
    assert.equal(contexts[0].data_path, contexts[1].data_path);
    assert.match(contexts[0].data_path, /\/memory\/agents\/coder\/plugins\/context_probe$/u);
    assert.equal(lifecycle_events.filter((item) => item === "start:default").length, 1);

    await first.leave();
    assert.equal(get_workspace_entry(agent, "sdk"), null);
    assert.equal(get_workspace_entry(agent, "homepage"), second);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }

});

test("PluginContext sessions keep the current Workspace binding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-plugin-sessions-"));
  let linked_session_id = "";
  const plugin = create_plugin({
    name: "session_probe",
    title: "Session Probe",
    description: "Validates the current Workspace Session view.",
    actions: {
      inspect: {
        description: "Restore one Session and create another in the current Workspace.",
        execute: async ({ context }) => {
          const linked_session = await context.agent.sessions.get(linked_session_id);
          const task_session = await context.agent.sessions.create();
          await context.agent.sessions.runtime(linked_session_id).append_assistant_message({
            text: "task completed",
          });
          return {
            success: true,
            data: {
              linked_workspace_id: linked_session.workspace_id,
              task_workspace_id: task_session.workspace_id,
              direct_session_id: context.session?.id,
              direct_turn_id: context.turn?.id,
              direct_agent_id: context.agent.id,
              direct_workspace_id: context.workspace.id,
            },
          };
        },
      },
    },
  });
  const agent = new Agent({ id: "plugin-session-agent" });
  const workspace = new Workspace({
    id: "plugin-session-workspace",
    path: root,
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent, { plugins: [create_plugin_binding(city, plugin)] });
  const entry = create_workspace_entry(agent, workspace);

  try {
    const linked_session = await entry.sessions.create();
    linked_session_id = linked_session.id;
    const mutations = [];
    const unsubscribe = linked_session.subscribe((mutation) => {
      mutations.push(mutation);
    });
    const result = await entry.plugins.run_action({
      plugin: "session_probe",
      action: "inspect",
      execution_context: {
        session_id: linked_session.id,
        session_origin: linked_session.origin,
        turn_id: "turn-direct-context",
      },
    });
    unsubscribe();
    assert.equal(result.success, true);
    assert.deepEqual(result.data, {
      linked_workspace_id: "plugin-session-workspace",
      task_workspace_id: "plugin-session-workspace",
      direct_session_id: linked_session.id,
      direct_turn_id: "turn-direct-context",
      direct_agent_id: "plugin-session-agent",
      direct_workspace_id: "plugin-session-workspace",
    });
    const messages = await linked_session.messages();
    assert.equal(messages.items.at(-1)?.type, "assistant");
    assert.equal(messages.items.at(-1)?.parts.at(-1)?.type, "text");
    assert.equal(messages.items.at(-1)?.parts.at(-1)?.text, "task completed");
    assert.equal(
      mutations.some((mutation) =>
        mutation.variant === "message" && mutation.type === "assistant"
      ),
      true,
    );
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Plugin runtime data is isolated by Agent and shared across Workspaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-plugin-data-"));
  const contexts = [];
  const plugin = create_plugin({
    name: "data_probe",
    title: "Data Probe",
    description: "Records its runtime data path.",
    actions: {
      inspect: {
        description: "Read the runtime data path.",
        execute: ({ context }) => {
          contexts.push({ agent_id: context.agent.id, workspace_id: context.workspace.id, data_path: context.storage.path });
          return { success: true, data: { data_path: context.storage.path } };
        },
      },
    },
  });
  await Promise.all([
    fs.mkdir(path.join(root, "one")),
    fs.mkdir(path.join(root, "two")),
    fs.mkdir(path.join(root, "three")),
  ]);
  const agent_a = new Agent({ id: "data_agent_a" });
  const agent_b = new Agent({ id: "data_agent_b" });
  const first_workspace = new Workspace({ id: "one", path: path.join(root, "one"), data_root_path: path.join(root, "data") });
  const second_workspace = new Workspace({ id: "two", path: path.join(root, "two"), data_root_path: path.join(root, "data") });
  const third_workspace = new Workspace({ id: "three", path: path.join(root, "three"), data_root_path: path.join(root, "data") });
  const city = new City({ workspaces: [first_workspace, second_workspace, third_workspace] });
  const registration = create_plugin_registration(plugin);
  city.plugins.provide(registration);
  city.agents.add(agent_a, { plugins: [{ plugin_id: registration.id }] });
  city.agents.add(agent_b, { plugins: [{ plugin_id: registration.id }] });
  const first = create_workspace_entry(agent_a, first_workspace);
  const second = create_workspace_entry(agent_a, second_workspace);
  const third = create_workspace_entry(agent_b, third_workspace);
  try {
    await Promise.all([
      first.plugins.run_action({ plugin: "data_probe", action: "inspect" }),
      second.plugins.run_action({ plugin: "data_probe", action: "inspect" }),
      third.plugins.run_action({ plugin: "data_probe", action: "inspect" }),
    ]);
    const agent_a_paths = contexts.filter((item) => item.agent_id === "data_agent_a").map((item) => item.data_path);
    const agent_b_paths = contexts.filter((item) => item.agent_id === "data_agent_b").map((item) => item.data_path);
    assert.equal(new Set(agent_a_paths).size, 1);
    assert.equal(new Set(agent_b_paths).size, 1);
    assert.notEqual(agent_a_paths[0], agent_b_paths[0]);
    assert.match(agent_a_paths[0], /\/memory\/agents\/data_agent_a\/plugins\/data_probe$/u);
    assert.match(agent_b_paths[0], /\/memory\/agents\/data_agent_b\/plugins\/data_probe$/u);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Plugin can ignore Workspace while still receiving its Context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-global-plugin-"));
  let calls = 0;
  const plugin = create_plugin({
    name: "counter",
    title: "Counter",
    description: "Uses only Agent-level state.",
    actions: {
      increment: {
        description: "Increment Agent-level state.",
        execute: () => ({ success: true, data: { value: ++calls } }),
      },
    },
  });
  await Promise.all([
    fs.mkdir(path.join(root, "one")),
    fs.mkdir(path.join(root, "two")),
  ]);
  const agent = new Agent({ id: "global_counter" });
  const first_workspace = new Workspace({
    id: "one",
    path: path.join(root, "one"),
    data_root_path: path.join(root, "data"),
  });
  const second_workspace = new Workspace({
    id: "two",
    path: path.join(root, "two"),
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [first_workspace, second_workspace] });
  city.agents.add(agent, { plugins: [create_plugin_binding(city, plugin)] });
  const first = create_workspace_entry(agent, first_workspace);
  const second = create_workspace_entry(agent, second_workspace);
  try {
    assert.equal((await first.plugins.run_action({ plugin: "counter", action: "increment" })).data.value, 1);
    assert.equal((await second.plugins.run_action({ plugin: "counter", action: "increment" })).data.value, 2);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Workspace cleanup continues after one Plugin leave failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-cleanup-"));
  const lifecycle_events = [];
  const failing_plugin = create_plugin({
    name: "failing_cleanup",
    lifecycle: {
      leave_workspace: ({ workspace_id }) => {
        lifecycle_events.push(`failing:${workspace_id}`);
        throw new Error("cleanup failed");
      },
    },
  });
  const healthy_plugin = create_plugin({
    name: "healthy_cleanup",
    lifecycle: {
      leave_workspace: ({ workspace_id }) => lifecycle_events.push(`healthy:${workspace_id}`),
    },
  });
  const agent = new Agent({ id: "cleanup_agent" });
  const workspace = new Workspace({
    id: "cleanup",
    path: root,
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent, { plugins: [
    create_plugin_binding(city, failing_plugin),
    create_plugin_binding(city, healthy_plugin),
  ] });
  const entry = create_workspace_entry(agent, workspace);

  try {
    await entry.sessions.list();
    await entry.leave();
    assert.equal(get_workspace_entry(agent, "cleanup"), null);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
