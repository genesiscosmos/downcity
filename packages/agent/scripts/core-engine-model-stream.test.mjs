/**
 * @file 验证 Downcity 模型事件写入失败会终止当前 model step。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { run_model_step } from "../bin/executor/model/ModelStepRunner.js";

test("模型事件写入 canonical Session 失败时拒绝继续完成 turn", async () => {
  const abort_controller = new AbortController();
  const model = {
    id: "projection-failure-model",
    async stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: "request_1",
            model_id: "projection-failure-model",
          });
          controller.enqueue({ type: "text_start", content_id: "text_1" });
          controller.enqueue({ type: "text_delta", content_id: "text_1", delta: "partial" });
          controller.enqueue({ type: "text_finish", content_id: "text_1" });
          controller.enqueue({
            type: "model_usage",
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          });
          controller.enqueue({ type: "model_finish", finish_reason: "stop" });
          controller.close();
        },
      });
    },
  };

  await assert.rejects(
    run_model_step({
      model,
      system: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: {},
      abort_signal: abort_controller.signal,
      assistant_output: {
        write_model_event: async () => {
          throw new Error("canonical write failed");
        },
      },
    }),
    /canonical write failed/,
  );
});

test("Agent 拒绝不合法的 Downcity 模型流状态", async () => {
  const invalid_event_sets = [
    [{ type: "text_delta", content_id: "text_1", delta: "orphan" }],
    [
      { type: "model_start", request_id: "request_1", model_id: "invalid-model" },
      { type: "tool_call_finish", content_id: "tool_1", input: {} },
    ],
    [
      { type: "model_start", request_id: "request_1", model_id: "invalid-model" },
      { type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      { type: "model_finish", finish_reason: "tool_call" },
    ],
  ];

  for (const events of invalid_event_sets) {
    const model = {
      id: "invalid-model",
      async stream() {
        return new ReadableStream({
          start(controller) {
            for (const event of events) controller.enqueue(event);
            controller.close();
          },
        });
      },
    };
    await assert.rejects(run_model_step({
      model,
      system: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: {},
      abort_signal: new AbortController().signal,
    }), /Invalid Downcity model stream/);
  }
});
