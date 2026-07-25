/**
 * @file 验证多个 Agent 经 session.prompt 执行 plugin_call 时保持 registry 隔离。
 *
 * 两个 CityModel 并发进入原生 LanguageModelV3 tool loop，第二次模型调用必须只
 * 收到各自 Agent plugin action 返回的 owner。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { MockLanguageModelV3 } from "ai/test";

import { Agent, Workspace } from "../bin/index.js";
import { createAction, createPlugin } from "../bin/plugin/core/PluginActionFactory.js";
import { CITY_MODEL_KIND } from "@downcity/type";

/** 构造 AI SDK V3 usage。 */
function create_usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}

/** 返回普通文本模型流。 */
function create_text_stream(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({ type: "text-delta", id: "text_1", delta: text });
        controller.enqueue({ type: "text-end", id: "text_1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: create_usage(),
        });
        controller.close();
      },
    }),
  };
}

/** 返回一次 plugin_call tool call。 */
function create_plugin_call_stream(model_id) {
  const tool_input = JSON.stringify({
    plugin: "skill",
    action: "lookup",
    payload: {},
  });
  const call_id = `call_${model_id}`;
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "tool-input-start", id: call_id, toolName: "plugin_call" });
        controller.enqueue({ type: "tool-input-delta", id: call_id, delta: tool_input });
        controller.enqueue({ type: "tool-input-end", id: call_id });
        controller.enqueue({
          type: "tool-call",
          toolCallId: call_id,
          toolName: "plugin_call",
          input: tool_input,
        });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: create_usage(),
        });
        controller.close();
      },
    }),
  };
}

/** 创建原生 LanguageModelV3 CityModel。 */
function create_test_model(model_id, model_requests) {
  let request_count = 0;
  const language_model = new MockLanguageModelV3({
    modelId: model_id,
    doStream: async (options) => {
      if (!Array.isArray(options.tools) || options.tools.length === 0) {
        return create_text_stream(`Title ${model_id}`);
      }
      request_count += 1;
      const requests = model_requests.get(model_id) ?? [];
      requests.push(options);
      model_requests.set(model_id, requests);
      return request_count === 1
        ? create_plugin_call_stream(model_id)
        : create_text_stream("done");
    },
  });
  return Object.assign(language_model, {
    id: model_id,
    name: model_id,
    description: "Multi-agent plugin isolation model",
    modalities: ["text", "stream"],
    tags: [],
    meta: {},
    kind: CITY_MODEL_KIND,
  });
}

/** 创建返回固定 owner 的 skill plugin。 */
function create_owner_plugin(owner, executed_owners) {
  return createPlugin({
    name: "skill",
    title: `Skill ${owner}`,
    description: "Return the owning Agent id",
    actions: {
      lookup: createAction({
        description: "Return registry owner",
        execute: async () => {
          executed_owners.push(owner);
          return {
            success: true,
            data: { owner },
            message: owner,
          };
        },
      }),
    },
  });
}

test("multiple session prompts use only their owning Agent plugin registry", async () => {
  const model_requests = new Map();
  const executed_owners = [];
  const root_a = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-plugin-isolation-a-"));
  const root_b = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-plugin-isolation-b-"));
  const agent_a = new Agent({
    id: "agent_a",
    workspace: new Workspace({ path: root_a }),
    plugins: [create_owner_plugin("agent_a", executed_owners)],
    model: create_test_model("model_a", model_requests),
  });
  const agent_b = new Agent({
    id: "agent_b",
    workspace: new Workspace({ path: root_b }),
    plugins: [create_owner_plugin("agent_b", executed_owners)],
    model: create_test_model("model_b", model_requests),
  });

  try {
    const session_a = await agent_a.sessions.create({ sessionId: "session_a" });
    const session_b = await agent_b.sessions.create({ sessionId: "session_b" });
    const [turn_a, turn_b] = await Promise.all([
      session_a.prompt({ query: "Call your skill plugin" }),
      session_b.prompt({ query: "Call your skill plugin" }),
    ]);
    const [result_a, result_b] = await Promise.all([turn_a.finished, turn_b.finished]);

    assert.equal(result_a.success, true);
    assert.equal(result_b.success, true);
    assert.deepEqual([...executed_owners].sort(), ["agent_a", "agent_b"]);
    for (const [model_id, owner] of [["model_a", "agent_a"], ["model_b", "agent_b"]]) {
      const requests = model_requests.get(model_id) ?? [];
      assert.equal(requests.length, 2);
      assert.match(JSON.stringify(requests[1].prompt), new RegExp(owner));
    }
  } finally {
    await Promise.all([agent_a.dispose(), agent_b.dispose()]);
  }
});
