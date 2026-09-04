/** Agent 原生 Downcity Model Protocol 工具循环测试。 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { define_runtime_tool } from "@downcity/type";
import { z } from "zod";
import { Agent } from "../../agent/bin/index.js";
import { create_workspace_entry } from "../../agent/bin/internal/index.js";
import { Workspace } from "@downcity/city";

const usage = { input_tokens: 5, output_tokens: 3, total_tokens: 8 };

function event_stream(events) {
  return new ReadableStream({ start(controller) {
    for (const event of events) controller.enqueue(event);
    controller.close();
  } });
}

test("Agent executes a RuntimeTool and sends tool_result into the next ModelCall", async () => {
  const calls = [];
  let tool_executed = false;
  const model = {
    id: "mock-model",
    async stream(call) {
      calls.push(call);
      if (!call.tools?.length) {
        return event_stream([
          { type: "model_start", request_id: "title", model_id: this.id },
          { type: "text_start", content_id: "title_text" },
          { type: "text_delta", content_id: "title_text", delta: "Tool loop" },
          { type: "text_finish", content_id: "title_text" },
          { type: "model_usage", usage },
          { type: "model_finish", finish_reason: "stop" },
        ]);
      }
      const has_result = call.messages.some((message) => message.role === "tool");
      return has_result
        ? event_stream([
            { type: "model_start", request_id: "step_2", model_id: this.id },
            { type: "text_start", content_id: "text_2" },
            { type: "text_delta", content_id: "text_2", delta: "done" },
            { type: "text_finish", content_id: "text_2" },
            { type: "model_usage", usage },
            { type: "model_finish", finish_reason: "stop" },
          ])
        : event_stream([
            { type: "model_start", request_id: "step_1", model_id: this.id },
            { type: "tool_call_start", content_id: "tool_1", tool_call_id: "call_1", tool_name: "ping" },
            { type: "tool_call_delta", content_id: "tool_1", input_delta: "{\"value\":\"hello\"}" },
            { type: "tool_call_finish", content_id: "tool_1", input: { value: "hello" } },
            { type: "model_usage", usage },
            { type: "model_finish", finish_reason: "tool_call" },
          ]);
    },
  };
  const agent_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-model-tool-loop-"));
  const agent = new Agent({
    id: "tool_loop_agent",
    model,
    tools: {
      ping: define_runtime_tool({
        description: "ping tool",
        input_schema: z.object({ value: z.string() }),
        execute: async ({ value }, options) => {
          tool_executed = true;
          assert.equal(options.tool_call_id, "call_1");
          assert.equal(options.abort_signal instanceof AbortSignal, true);
          return { echoed: value };
        },
      }),
    },
  });
  const entry = create_workspace_entry(agent, new Workspace({
    id: "workspace", path: agent_path, data_root_path: path.join(agent_path, "data"),
  }));

  try {
    const session = await entry.sessions.create();
    const result = await (await session.prompt({ query: "use ping" })).finished;
    assert.equal(result.success, true);
    assert.equal(result.text, "done");
    assert.equal(tool_executed, true);
    const tool_call = calls.find((call) => call.tools?.some((tool) => tool.name === "ping"));
    assert.equal(tool_call.tools.find((tool) => tool.name === "ping").input_schema.type, "object");
    const follow_up = calls.find((call) => call.messages.some((message) => message.role === "tool"));
    const tool_result = follow_up.messages.find((message) => message.role === "tool").content[0];
    assert.equal(tool_result.tool_call_id, "call_1");
    assert.deepEqual(tool_result.content[0].value, { echoed: "hello" });
  } finally {
    await agent.dispose();
  }
});
