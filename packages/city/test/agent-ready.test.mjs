/**
 * @file 验证 Power 初始化不影响 Agent 主流程，且未就绪的 Power 不会被暴露。
 *
 * 关键点（中文）
 * - 这里走编译后的公开 SDK，覆盖宿主真实入口。
 * - Power 各自独立启动：初始化未完成既不阻塞 session.prompt，也不进入执行 Registry。
 */

import test from "node:test";
import {
  add_test_power,
  create_power_registration,
  create_test_power as create_power,
} from "./helpers/CityPowerTestBinding.mjs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";
import { Agent } from "@downcity/agent";
import { City } from "../bin/index.js";
import { Workspace } from "@downcity/city";

function create_deferred() {
  let resolve;
  const promise = new Promise((inner_resolve) => {
    resolve = inner_resolve;
  });
  return {
    promise,
    resolve,
  };
}

async function is_settled(promise) {
  const marker = {};
  const result = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise((resolve) => setTimeout(() => resolve(marker), 0)),
  ]);
  return result !== marker;
}

function create_stream_text_result(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [],
        });
        controller.enqueue({
          type: "text-start",
          id: "text_1",
        });
        controller.enqueue({
          type: "text-delta",
          id: "text_1",
          delta: text,
        });
        controller.enqueue({
          type: "text-end",
          id: "text_1",
        });
        controller.enqueue({
          type: "finish",
          finishReason: {
            unified: "stop",
            raw: "stop",
          },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 0,
              text: 0,
              reasoning: 0,
            },
          },
        });
        controller.close();
      },
    }),
  };
}

test("pending Power 初始化不阻塞 session.prompt", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-ready-"),
  );
  const lifecycle_ready = create_deferred();
  let model_stream_calls = 0;

  const blocking_power = create_power({
    name: "blocking",
    title: "Blocking",
    description: "Blocks lifecycle initialization until the test releases it",
    lifecycle: {
      initialize: async () => {
        await lifecycle_ready.promise;
      },
    },
  });
  const model = new MockModelClient({
    modelId: "agent-ready-model",
    doStream: async () => {
      model_stream_calls += 1;
      return create_stream_text_result("ready");
    },
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: "Ready title",
        },
      ],
      finishReason: {
        unified: "stop",
        raw: "stop",
      },
      usage: {
        inputTokens: {
          total: 0,
          noCache: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 0,
          text: 0,
          reasoning: 0,
        },
      },
      warnings: [],
    }),
  });
  const agent = new Agent({ id: "ready_agent", model });
  const workspace = new Workspace({ id: "ready_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") });
  const city = new City({ workspaces: [workspace] });
  // 关键点（中文）：这个 Power 的 initialize 会一直挂起，必须不等待注册；
  // 本用例验证的正是「Power 未就绪不阻塞主流程」。
  void city.powers.add(create_power_registration(blocking_power)).catch(() => undefined);
  city.agents.add(agent);

  try {
    const session = await agent.sessions.create({
      session_id: "ready_session",
      workspace,
    });
    const turn = await session.prompt({
      query: "hello",
    });
    const result = await turn.finished;

    // 关键点：Power 还在初始化，但主流程已经跑完一轮模型调用。
    assert.equal(result.success, true);
    assert.equal(model_stream_calls, 1);
    const pending = city.powers.snapshots().find((item) => item.name === "blocking");
    assert.equal(pending?.status, "initializing");

    lifecycle_ready.resolve();
    await city.powers.settled();
    const ready = city.powers.snapshots().find((item) => item.name === "blocking");
    assert.equal(ready?.status, "ready");
  } finally {
    lifecycle_ready.resolve();
    await city.close();
  }
});

test("未就绪的 Power 直接调用立即失败，不等待初始化", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-power-ready-"),
  );
  const lifecycle_ready = create_deferred();
  let lifecycle_started = false;
  let action_calls = 0;
  const power = create_power({
    name: "direct-action",
    title: "Direct Action",
    description: "Waits for lifecycle before direct calls",
    lifecycle: {
      initialize: async () => {
        await lifecycle_ready.promise;
        lifecycle_started = true;
      },
    },
    actions: {
      status: {
        description: "Read lifecycle status",
        execute: async () => {
          action_calls += 1;
          return { success: true, data: { lifecycle_started } };
        },
      },
    },
  });
  const agent = new Agent({ id: "power_ready_agent" });
  const workspace = new Workspace({ id: "power_ready_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") });
  const city = new City({ workspaces: [workspace] });
  // 关键点（中文）：initialize 挂起，因此不能等待注册；未就绪的 Power 不进入 Registry。
  void city.powers.add(create_power_registration(power)).catch(() => undefined);
  city.agents.add(agent);
  try {
    const scope = city.powers.scope({
      agent_id: agent.id,
      workspace_id: workspace.id,
    });
    const pending_result = await scope.run_action({
      power: "direct-action",
      action: "status",
    });
    // 关键点：未注册的 Power 不进入 Registry，调用立即失败而不是挂起。
    assert.equal(pending_result.success, false);
    assert.match(pending_result.error, /Unknown power/u);
    assert.equal(action_calls, 0);

    lifecycle_ready.resolve();
    await city.powers.settled();
    const result = await scope.run_action({
      power: "direct-action",
      action: "status",
    });
    assert.equal(result.success, true);
    assert.equal(result.data.lifecycle_started, true);
    assert.equal(action_calls, 1);
  } finally {
    lifecycle_ready.resolve();
    await city.close();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
});

test("首次 Session 操作等待初始化并隔离 Power lifecycle 初始化失败", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-ready-isolation-"),
  );
  let healthy_started = false;
  const failing_power = create_power({
    name: "failing",
    lifecycle: {
      initialize: async () => {
        throw new Error("start failed");
      },
    },
  });
  const healthy_power = create_power({
    name: "healthy",
    lifecycle: {
      initialize: async () => {
        healthy_started = true;
      },
    },
  });
  const agent = new Agent({ id: "ready_isolation_agent" });
  const workspace = new Workspace({ id: "isolation_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") });
  const city = new City({ workspaces: [workspace] });
  // 关键点（中文）：一个 Power 初始化失败、一个成功；两个都独立启动，不互相影响。
  void city.powers.add(create_power_registration(failing_power)).catch(() => undefined);
  await add_test_power(city, healthy_power);
  city.agents.add(agent);
  try {
    await agent.sessions.create({ session_id: "initial_barrier", workspace });

    assert.equal(healthy_started, true);
    const failing_snapshot = city.powers
      .snapshots()
      .find((item) => item.name === "failing");
    assert.equal(failing_snapshot?.status, "error");
    assert.equal(failing_snapshot?.last_error, "start failed");
    assert.equal(city.powers.snapshots(agent.id).find((item) => item.name === "healthy")?.status, "ready");
  } finally {
    await city.close();
  }
});

test("Agent registers PowerRegistry tools and removes them with the last action power", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-state-power-tools-"),
  );
  const agent = new Agent({
    id: "state_power_tools_agent",
  });
  const workspace = new Workspace({ id: "power_tools_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") });
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  const action_power = create_power({
    name: "dynamic_action",
    actions: {
      ping: {
        description: "Return pong",
        execute: async () => ({ success: true, data: { value: "pong" } }),
      },
    },
  });

  try {
    const powers = city.powers.scope({ agent_id: agent.id, workspace_id: workspace.id });
    assert.equal(powers.list().some((item) => item.name === "dynamic_action"), false);

    await add_test_power(city, action_power);
    await city.powers.settled();

    assert.equal(powers.list().some((item) => item.name === "dynamic_action"), true);

    await city.powers.remove("dynamic_action");

    assert.equal(powers.list().some((item) => item.name === "dynamic_action"), false);
  } finally {
    await city.close();
  }
});

test("初始化中的 City Power 发布后会刷新已创建 Workspace 的 tools", async () => {
  const lifecycle_ready = create_deferred();
  const agent = new Agent({ id: "pending_power_tools_agent" });
  const workspace = new Workspace({
    id: "pending_power_tools_workspace",
    path: process.cwd(),
  });
  const power = create_power({
    name: "pending_action",
    lifecycle: {
      initialize: async () => await lifecycle_ready.promise,
    },
    actions: {
      ping: {
        description: "Return pong after initialization",
        execute: async () => ({ success: true, data: { value: "pong" } }),
      },
    },
  });
  const city = new City({
    powers: [create_power_registration(power)],
    workspaces: [workspace],
    agents: [agent],
  });
  try {
    const powers = city.powers.scope({ agent_id: agent.id, workspace_id: workspace.id });
    assert.equal(powers.list().some((item) => item.name === "pending_action"), false);
    lifecycle_ready.resolve();
    await city.powers.settled();
    assert.equal(powers.list().some((item) => item.name === "pending_action"), true);
  } finally {
    lifecycle_ready.resolve();
    await city.close();
  }
});
