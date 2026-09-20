/** 验证一个 Agent 可以进入多个 Workspace，且 Power Context 与生命周期彼此隔离。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@downcity/agent";
import { City } from "../bin/index.js";
import { Workspace } from "@downcity/city";
import {
  add_test_power,
  create_power_registration,
  create_test_power as create_power,
} from "./helpers/CityPowerTestBinding.mjs";

test("one Agent enters multiple Workspaces with contextual Power execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-workspaces-"));
  const lifecycle_events = [];
  const contexts = [];
  const power = create_power({
    name: "context_probe",
    title: "Context Probe",
    description: "Records the current Workspace Context.",
    lifecycle: {
      initialize: () => lifecycle_events.push("initialize"),
      dispose: () => lifecycle_events.push("dispose"),
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
  await add_test_power(city, power);
  city.agents.add(agent);

  try {
    const first_powers = city.powers.scope({ agent_id: agent.id, workspace_id: first_workspace.id });
    const second_powers = city.powers.scope({ agent_id: agent.id, workspace_id: second_workspace.id });
    const [first_result, second_result] = await Promise.all([
      first_powers.run_action({ power: "context_probe", action: "inspect" }),
      second_powers.run_action({ power: "context_probe", action: "inspect" }),
    ]);
    assert.equal(first_result.data.workspace_id, "sdk");
    assert.equal(second_result.data.workspace_id, "homepage");
    assert.deepEqual(new Set(contexts.map((item) => item.workspace_id)), new Set(["sdk", "homepage"]));
    assert.equal(contexts[0].data_path, contexts[1].data_path);
    assert.match(contexts[0].data_path, /\/memory\/agents\/coder\/powers\/context_probe$/u);
    assert.equal(lifecycle_events.filter((item) => item === "initialize").length, 1);

    assert.equal(await city.workspaces.remove("sdk"), first_workspace);
    assert.equal(city.workspaces.get("sdk"), null);
    assert.equal(city.workspaces.get("homepage"), second_workspace);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }

});

test("PowerContext sessions keep the current Workspace binding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-power-sessions-"));
  let linked_session_id = "";
  const power = create_power({
    name: "session_probe",
    title: "Session Probe",
    description: "Validates the current Workspace Session view.",
    actions: {
      inspect: {
        description: "Restore one Session and create another in the current Workspace.",
        execute: async ({ context }) => {
          const linked_session = await context.agent.sessions.get(linked_session_id);
          const task_session = await context.agent.sessions.create();
          await context.agent.sessions.runtime(linked_session_id).append_agent_message({
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
  const agent = new Agent({ id: "power-session-agent" });
  const workspace = new Workspace({
    id: "power-session-workspace",
    path: root,
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [workspace] });
  await add_test_power(city, power);
  city.agents.add(agent);

  try {
    const linked_session = await agent.sessions.create({ workspace });
    linked_session_id = linked_session.id;
    const mutations = [];
    const unsubscribe = linked_session.subscribe((mutation) => {
      mutations.push(mutation);
    });
    const result = await city.powers.scope({
      agent_id: agent.id,
      workspace_id: workspace.id,
    }).run_action({
      power: "session_probe",
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
      linked_workspace_id: "power-session-workspace",
      task_workspace_id: "power-session-workspace",
      direct_session_id: linked_session.id,
      direct_turn_id: "turn-direct-context",
      direct_agent_id: "power-session-agent",
      direct_workspace_id: "power-session-workspace",
    });
    const messages = await linked_session.messages();
    assert.equal(messages.items.at(-1)?.role, "agent");
    assert.equal(messages.items.at(-1)?.parts.at(-1)?.type, "text");
    assert.equal(messages.items.at(-1)?.parts.at(-1)?.text, "task completed");
    assert.equal(
      mutations.some((mutation) =>
        mutation.variant === "message" && mutation.role === "agent"
      ),
      true,
    );
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Power runtime data is isolated by Agent and shared across Workspaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-power-data-"));
  const contexts = [];
  const power = create_power({
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
  const registration = create_power_registration(power);
  await city.powers.add(registration);
  city.agents.add(agent_a);
  city.agents.add(agent_b);
  try {
    await Promise.all([
      city.powers.scope({ agent_id: agent_a.id, workspace_id: first_workspace.id })
        .run_action({ power: "data_probe", action: "inspect" }),
      city.powers.scope({ agent_id: agent_a.id, workspace_id: second_workspace.id })
        .run_action({ power: "data_probe", action: "inspect" }),
      city.powers.scope({ agent_id: agent_b.id, workspace_id: third_workspace.id })
        .run_action({ power: "data_probe", action: "inspect" }),
    ]);
    const agent_a_paths = contexts.filter((item) => item.agent_id === "data_agent_a").map((item) => item.data_path);
    const agent_b_paths = contexts.filter((item) => item.agent_id === "data_agent_b").map((item) => item.data_path);
    assert.equal(new Set(agent_a_paths).size, 1);
    assert.equal(new Set(agent_b_paths).size, 1);
    assert.notEqual(agent_a_paths[0], agent_b_paths[0]);
    assert.match(agent_a_paths[0], /\/memory\/agents\/data_agent_a\/powers\/data_probe$/u);
    assert.match(agent_b_paths[0], /\/memory\/agents\/data_agent_b\/powers\/data_probe$/u);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Power can ignore Workspace while still receiving its Context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-global-power-"));
  let calls = 0;
  const power = create_power({
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
  await add_test_power(city, power);
  city.agents.add(agent);
  try {
    assert.equal((await city.powers.scope({ agent_id: agent.id, workspace_id: first_workspace.id })
      .run_action({ power: "counter", action: "increment" })).data.value, 1);
    assert.equal((await city.powers.scope({ agent_id: agent.id, workspace_id: second_workspace.id })
      .run_action({ power: "counter", action: "increment" })).data.value, 2);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Workspace cleanup is independent from Power lifecycle", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-cleanup-"));
  const power = create_power({ name: "cleanup_observer" });
  const agent = new Agent({ id: "cleanup_agent" });
  const workspace = new Workspace({
    id: "cleanup",
    path: root,
    data_root_path: path.join(root, "data"),
  });
  const city = new City({ workspaces: [workspace] });
  await add_test_power(city, power);
  city.agents.add(agent);

  try {
    await agent.sessions.list({ workspace_id: workspace.id });
    assert.equal(await city.workspaces.remove(workspace.id), workspace);
    assert.equal(city.workspaces.get(workspace.id), null);
  } finally {
    await city.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
