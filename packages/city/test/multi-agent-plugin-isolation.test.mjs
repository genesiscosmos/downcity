/**
 * @file 验证多个 Agent 经 session.prompt 执行 plugin_call 时保持 registry 隔离。
 *
 * 两个 CityModel 并发进入原生 Downcity Model Protocol 工具循环，第二次模型调用必须只
 * 收到各自 Agent plugin action 返回的 owner。
 */

import test from "node:test";
import {
  create_plugin_registration,
  create_test_plugin as create_plugin,
} from "./helpers/CityPluginTestBinding.mjs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";

import { Agent } from "@downcity/agent";
import { City } from "../bin/index.js";
import { Workspace } from "@downcity/city";
import { create_action } from "@downcity/city/plugin";
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

/** 创建原生 Downcity ModelClient。 */
function create_test_model(model_id, model_requests) {
  let request_count = 0;
  const language_model = new MockModelClient({
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

/** 创建通过动态 Context 返回当前 Agent ID 的共享 skill plugin。 */
function create_owner_plugin(executed_owners) {
  return create_plugin({
    name: "skill",
    title: "Shared Skill",
    description: "Return the owning Agent id",
    actions: {
      lookup: create_action({
        description: "Return registry owner",
        execute: async ({ context }) => {
          const owner = context.agent.id;
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
    model: create_test_model("model_a", model_requests),
  });
  const agent_b = new Agent({
    id: "agent_b",
    model: create_test_model("model_b", model_requests),
  });
  const workspace_a = new Workspace({ id: "workspace_a", path: root_a, data_root_path: path.join(root_a, "data") });
  const workspace_b = new Workspace({ id: "workspace_b", path: root_b, data_root_path: path.join(root_b, "data") });
  const city = new City({ workspaces: [workspace_a, workspace_b] });
  const registration = create_plugin_registration(create_owner_plugin(executed_owners));
  await city.plugins.add(registration);
  city.agents.add(agent_a);
  city.agents.add(agent_b);

  try {
    await Promise.all([agent_a.ensure_ready(), agent_b.ensure_ready()]);
    const session_a = await agent_a.sessions.create({ session_id: "session_a", workspace: workspace_a });
    const session_b = await agent_b.sessions.create({ session_id: "session_b", workspace: workspace_b });
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
    await city.close();
  }
});
