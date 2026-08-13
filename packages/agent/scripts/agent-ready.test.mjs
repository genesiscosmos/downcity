/**
 * @file 验证 session.prompt 会等待当前 Agent runtime ready。
 *
 * 关键点（中文）
 * - 这里走编译后的公开 SDK，覆盖宿主真实入口。
 * - plugin lifecycle 未完成前，session.prompt 不应进入模型执行。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { MockLanguageModelV3 } from "ai/test";
import { Agent, Workspace } from "../bin/index.js";
import { create_plugin } from "../bin/plugin/core/PluginActionFactory.js";

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

test("session.prompt waits for agent runtime ready before model execution", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-ready-"),
  );
  const lifecycle_ready = create_deferred();
  let model_stream_calls = 0;

  const blocking_plugin = create_plugin({
    name: "blocking",
    title: "Blocking",
    description: "Blocks lifecycle start until the test releases it",
    lifecycle: {
      start: async () => {
        await lifecycle_ready.promise;
      },
    },
  });
  const model = new MockLanguageModelV3({
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
  const agent = new Agent({
    id: "ready_agent",
    workspace: new Workspace({ path: agent_path }),
    plugins: [blocking_plugin],
    model,
  });

  try {
    const session = await agent.sessions.create({
      session_id: "ready_session",
    });
    const prompt_promise = session.prompt({
      query: "hello",
    });

    assert.equal(await is_settled(prompt_promise), false);
    assert.equal(model_stream_calls, 0);

    lifecycle_ready.resolve();
    const turn = await prompt_promise;
    const result = await turn.finished;

    assert.equal(result.success, true);
    assert.equal(model_stream_calls, 2);
  } finally {
    lifecycle_ready.resolve();
    await agent.dispose();
  }
});

test("首次 Session 操作等待初始化并隔离 Plugin lifecycle 启动失败", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-ready-isolation-"),
  );
  let healthy_started = false;
  const failing_plugin = create_plugin({
    name: "failing",
    lifecycle: {
      start: async () => {
        throw new Error("start failed");
      },
    },
  });
  const healthy_plugin = create_plugin({
    name: "healthy",
    lifecycle: {
      start: async () => {
        healthy_started = true;
      },
    },
  });
  const agent = new Agent({
    id: "ready_isolation_agent",
    workspace: new Workspace({ path: agent_path }),
    plugins: [failing_plugin, healthy_plugin],
  });

  try {
    await agent.sessions.create({ session_id: "initial_barrier" });

    assert.equal(healthy_started, true);
    assert.equal(agent.plugins.status("failing")?.status, "error");
    assert.equal(agent.plugins.status("healthy")?.status, "ready");
  } finally {
    await agent.dispose();
  }
});

test("Agent registers PluginRegistry tools and removes them with the last action plugin", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-state-plugin-tools-"),
  );
  const agent = new Agent({
    id: "state_plugin_tools_agent",
    workspace: new Workspace({ path: agent_path }),
  });
  const action_plugin = create_plugin({
    name: "dynamic_action",
    actions: {
      ping: {
        description: "Return pong",
        execute: async () => ({ success: true, data: { value: "pong" } }),
      },
    },
  });

  try {
    assert.equal(agent.tools.plugin_read, undefined);
    assert.equal(agent.tools.plugin_call, undefined);

    await agent.plugins.register(action_plugin);

    assert.notEqual(agent.tools.plugin_read, undefined);
    assert.notEqual(agent.tools.plugin_call, undefined);

    await agent.plugins.unregister("dynamic_action");

    assert.equal(agent.tools.plugin_read, undefined);
    assert.equal(agent.tools.plugin_call, undefined);
  } finally {
    await agent.dispose();
  }
});
