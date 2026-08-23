/** 验证一个 Agent 可以进入多个 Workspace，且 Plugin Context 与生命周期彼此隔离。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, create_plugin } from "../bin/index.js";
import { create_agent_workspace, get_agent_workspace } from "../bin/internal/index.js";
import { Workspace } from "@downcity/workspace";

test("one Agent enters multiple Workspaces with contextual Plugin execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-workspaces-"));
  const lifecycle_events = [];
  const contexts = [];
  const plugin = create_plugin({
    name: "context_probe",
    title: "Context Probe",
    description: "Records the current Workspace Context.",
    lifecycle: {
      start: ({ agent_id }) => lifecycle_events.push(`start:${agent_id}`),
      enter_workspace: ({ workspace_id }) => lifecycle_events.push(`enter:${workspace_id}`),
      leave_workspace: ({ workspace_id }) => lifecycle_events.push(`leave:${workspace_id}`),
      stop: ({ agent_id }) => lifecycle_events.push(`stop:${agent_id}`),
    },
    actions: {
      inspect: {
        description: "Read the current Workspace Context.",
        execute: ({ context }) => {
          contexts.push({
            agent_id: context.agent_id,
            workspace_id: context.workspace_id,
            workspace_path: context.workspace_path,
            data_path: context.data_path,
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
  const agent = new Agent({ id: "coder", plugins: [plugin] });
  const first = create_agent_workspace(agent, new Workspace({
    id: "sdk",
    path: path.join(root, "sdk"),
    data_root_path: path.join(root, "data"),
  }));
  const second = create_agent_workspace(agent, new Workspace({
    id: "homepage",
    path: path.join(root, "homepage"),
    data_root_path: path.join(root, "data"),
  }));

  try {
    const [first_result, second_result] = await Promise.all([
      first.plugins.run_action({ plugin: "context_probe", action: "inspect" }),
      second.plugins.run_action({ plugin: "context_probe", action: "inspect" }),
    ]);
    assert.equal(first_result.data.workspace_id, "sdk");
    assert.equal(second_result.data.workspace_id, "homepage");
    assert.deepEqual(new Set(contexts.map((item) => item.workspace_id)), new Set(["sdk", "homepage"]));
    assert.equal(contexts[0].data_path, contexts[1].data_path);
    assert.match(contexts[0].data_path, /data\/agents\/coder\/plugins\/context_probe$/u);
    assert.equal(lifecycle_events.filter((item) => item === "start:coder").length, 1);
    assert.equal(lifecycle_events.filter((item) => item.startsWith("enter:")).length, 2);

    await first.leave();
    assert.equal(get_agent_workspace(agent, "sdk"), null);
    assert.equal(get_agent_workspace(agent, "homepage"), second);
    assert.equal(lifecycle_events.includes("leave:sdk"), true);
    assert.equal(lifecycle_events.includes("stop:coder"), false);
  } finally {
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }

  assert.equal(lifecycle_events.includes("leave:homepage"), true);
  assert.equal(lifecycle_events.filter((item) => item === "stop:coder").length, 1);
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
          contexts.push({ agent_id: context.agent_id, workspace_id: context.workspace_id, data_path: context.data_path });
          return { success: true, data: { data_path: context.data_path } };
        },
      },
    },
  });
  await Promise.all([
    fs.mkdir(path.join(root, "one")),
    fs.mkdir(path.join(root, "two")),
    fs.mkdir(path.join(root, "three")),
  ]);
  const agent_a = new Agent({ id: "data_agent_a", plugins: [plugin] });
  const agent_b = new Agent({ id: "data_agent_b", plugins: [create_plugin({
    name: "data_probe",
    title: "Data Probe",
    description: "Records its runtime data path.",
    actions: {
      inspect: {
        description: "Read the runtime data path.",
        execute: ({ context }) => {
          contexts.push({ agent_id: context.agent_id, workspace_id: context.workspace_id, data_path: context.data_path });
          return { success: true, data: { data_path: context.data_path } };
        },
      },
    },
  })] });
  const first = create_agent_workspace(agent_a, new Workspace({ id: "one", path: path.join(root, "one"), data_root_path: path.join(root, "data") }));
  const second = create_agent_workspace(agent_a, new Workspace({ id: "two", path: path.join(root, "two"), data_root_path: path.join(root, "data") }));
  const third = create_agent_workspace(agent_b, new Workspace({ id: "three", path: path.join(root, "three"), data_root_path: path.join(root, "data") }));
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
    assert.match(agent_a_paths[0], /data\/agents\/data_agent_a\/plugins\/data_probe$/u);
    assert.match(agent_b_paths[0], /data\/agents\/data_agent_b\/plugins\/data_probe$/u);
  } finally {
    await Promise.all([agent_a.dispose(), agent_b.dispose()]);
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
  const agent = new Agent({ id: "global_counter", plugins: [plugin] });
  const first = create_agent_workspace(agent, new Workspace({
    id: "one",
    path: path.join(root, "one"),
    data_root_path: path.join(root, "data"),
  }));
  const second = create_agent_workspace(agent, new Workspace({
    id: "two",
    path: path.join(root, "two"),
    data_root_path: path.join(root, "data"),
  }));
  try {
    assert.equal((await first.plugins.run_action({ plugin: "counter", action: "increment" })).data.value, 1);
    assert.equal((await second.plugins.run_action({ plugin: "counter", action: "increment" })).data.value, 2);
  } finally {
    await agent.dispose();
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
  const agent = new Agent({
    id: "cleanup_agent",
    plugins: [failing_plugin, healthy_plugin],
  });
  const entry = create_agent_workspace(agent, new Workspace({
    id: "cleanup",
    path: root,
    data_root_path: path.join(root, "data"),
  }));

  try {
    await entry.sessions.list();
    await assert.rejects(entry.leave(), /AgentWorkspace cleanup failed/u);
    assert.equal(get_agent_workspace(agent, "cleanup"), null);
    assert.deepEqual(
      new Set(lifecycle_events),
      new Set(["failing:cleanup", "healthy:cleanup"]),
    );
  } finally {
    await agent.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
