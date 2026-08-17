/**
 * @file 验证 Agent 直接调用实现 LanguageModelV3 的 CityModel 并完成 tool loop。
 *
 * 关键点（中文）
 * - 测试模型自身已经实现 LanguageModelV3，Agent 不再创建第二个 Provider 模型。
 * - 第一次调用返回 tool-call，Agent 本地执行后把 tool-result 放进第二次调用。
 * - CityModel 的目录信息继续用于上下文窗口和日志，不参与网络连接转换。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { MockLanguageModelV3 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";

import { Agent } from "../bin/index.js";
import { Workspace } from "@downcity/workspace";
import { create_action, create_plugin } from "../bin/plugin/core/PluginActionFactory.js";
import { CITY_MODEL_KIND } from "@downcity/type";

/** 构造 AI SDK V3 usage。 */
function create_usage() {
  return {
    inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 3, reasoning: 0 },
  };
}

/** 构造一次 ping tool-call。 */
function create_tool_call_stream() {
  const input = JSON.stringify({ value: "hello" });
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "tool-input-start", id: "call_1", toolName: "ping" });
        controller.enqueue({ type: "tool-input-delta", id: "call_1", delta: input });
        controller.enqueue({ type: "tool-input-end", id: "call_1" });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "ping",
          input,
          providerMetadata: { openai: { itemId: "fc_1" } },
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

/** 构造普通文本完成流。 */
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

/** 给标准 LanguageModelV3 附加 CityModel 目录协议。 */
function create_city_model(model_requests) {
  let request_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "mock-model",
    doStream: async (options) => {
      if (!Array.isArray(options.tools) || options.tools.length === 0) {
        return create_text_stream("Tool loop");
      }
      request_count += 1;
      model_requests.push(options);
      return request_count === 1
        ? create_tool_call_stream()
        : create_text_stream("done");
    },
  });
  return Object.assign(model, {
    id: "mock-model",
    name: "Mock Model",
    description: "Native CityModel tool loop test",
    modalities: ["text", "stream"],
    tags: [],
    meta: {},
    kind: CITY_MODEL_KIND,
  });
}

test("CityModel uses direct LanguageModel path and sends tool result back", async () => {
  const model_requests = [];
  let tool_executed = false;
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-city-model-tool-loop-"),
  );
  const input_image_path = path.join(agent_path, "tool-input.png");
  await fs.writeFile(input_image_path, Buffer.from("tool-input-image"));
  const skill_plugin = create_plugin({
    name: "skill",
    title: "Skill",
    description: "Test skill plugin",
    actions: {
      lookup: create_action({
        description: "Lookup a skill",
        execute: async ({ input }) => ({
          success: true,
          data: { name: input.name },
          message: "loaded",
        }),
      }),
    },
  });
  const agent = new Agent({
    id: "tool_loop_agent",
    plugins: [skill_plugin],
    tools: {
      ping: tool({
        description: "ping tool",
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => {
          tool_executed = true;
          return {
            output: { echoed: value },
            messages: [
              {
                role: "assistant",
                parts: [{
                  type: "file",
                  mediaType: "image/png",
                  url: "/workspace/tool-output.png",
                  filename: "tool-output.png",
                }],
              },
              {
                role: "user",
                parts: [{
                  type: "file",
                  mediaType: "image/png",
                  url: input_image_path,
                  filename: "tool-input.png",
                }],
              },
            ],
          };
        },
      }),
    },
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") }));

  try {
    const session = await entry.sessions.create();
    await session.set({ model: create_city_model(model_requests) });
    const turn = await session.prompt({ query: "please use the ping tool" });
    const result = await turn.finished;

    assert.equal(result.success, true);
    assert.equal(tool_executed, true);
    assert.equal(model_requests.length, 2);
    assert.equal(model_requests[0].providerOptions, undefined);
    assert.equal(model_requests[1].providerOptions, undefined);
    const plugin_call_tool = model_requests[0].tools.find((item) => item.name === "plugin_call");
    assert.ok(plugin_call_tool);
    assert.equal(plugin_call_tool.inputSchema.type, "object");
    assert.deepEqual(plugin_call_tool.inputSchema.required, ["plugin", "action"]);
    assert.equal(plugin_call_tool.inputSchema.additionalProperties, false);

    const serialized_second_prompt = JSON.stringify(model_requests[1].prompt);
    assert.match(serialized_second_prompt, /"role":"tool"/);
    assert.match(serialized_second_prompt, /call_1/);
    assert.match(serialized_second_prompt, /echoed/);
    assert.match(serialized_second_prompt, /hello/);
    const injected_file = model_requests[1].prompt
      .filter((message) => message.role === "user")
      .flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((part) => part.type === "file" && part.filename === "tool-input.png");
    assert.ok(injected_file, JSON.stringify(model_requests[1].prompt.at(-1)));
    assert.equal(injected_file.mediaType, "image/png");
    assert.equal(
      String(injected_file.data),
      Buffer.from("tool-input-image").toString("base64"),
    );
    const restored_tool_call = model_requests[1].prompt
      .flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((part) => part.type === "tool-call" && part.toolCallId === "call_1");
    assert.deepEqual(restored_tool_call.providerOptions, {
      openai: { itemId: "fc_1" },
    });

    const session_messages = await session.messages({ include_internal: true });
    const persisted_assistant = session_messages.items.find((message) => message.type === "assistant");
    const result_file = persisted_assistant.parts.find((part) => part.type === "file");
    assert.deepEqual(result_file, {
      part_id: result_file.part_id,
      sequence: result_file.sequence,
      type: "file",
      media_type: "image/png",
      url: "/workspace/tool-output.png",
      filename: "tool-output.png",
    });
    const persisted_tool = persisted_assistant.parts.find((part) => part.type === "tool");
    assert.deepEqual(persisted_tool.call_provider_metadata, {
      openai: { itemId: "fc_1" },
    });
  } finally {
    await agent.dispose();
  }
});
