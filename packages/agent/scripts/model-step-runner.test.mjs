/**
 * @file 验证 Downcity 模型事件写入失败会终止当前 model step。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { run_model_step } from "../bin/model/ModelStepRunner.js";
import { generate_model } from "../bin/model/ModelGenerate.js";
import { create_session_model_request_warning } from "../bin/session/runtime/SessionModelRequestWarning.js";
import { is_session_mutation } from "@downcity/type";
import {
  MAX_MODEL_REQUEST_ATTEMPTS,
  MAX_MODEL_REQUEST_RETRIES,
} from "../bin/model/ModelRequestRunner.js";

test("Agent 模型请求最多自动重试五次", () => {
  assert.equal(MAX_MODEL_REQUEST_RETRIES, 5);
  assert.equal(MAX_MODEL_REQUEST_ATTEMPTS, 6);
});

test("Session 边界把内部模型失败投影为 Warning Mutation", () => {
  const warning = create_session_model_request_warning({
    session_id: "session_1",
    notice: {
      request_kind: "session_title",
      code: "provider_timeout",
      message: "temporary timeout",
      retryable: true,
      attempt: 1,
      max_attempts: 6,
      will_retry: true,
    },
  });

  assert.equal(is_session_mutation(warning), true);
  assert.equal(warning.variant, "warning");
  assert.equal(warning.type, "model_request");
  assert.equal(warning.request_kind, "session_title");
  assert.equal(warning.turn_id, undefined);
});

test("非交互模型请求复用统一重试策略", async () => {
  let call_count = 0;
  const failures = [];
  const model = {
    id: "generated-content-model",
    async stream() {
      call_count += 1;
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: `request_${call_count}`,
            model_id: "generated-content-model",
          });
          if (call_count === 1) {
            controller.enqueue({
              type: "model_error",
              error: {
                code: "provider_timeout",
                message: "temporary timeout",
                retryable: true,
              },
            });
          } else {
            controller.enqueue({ type: "text_start", content_id: "text_1" });
            controller.enqueue({ type: "text_delta", content_id: "text_1", delta: "done" });
            controller.enqueue({ type: "text_finish", content_id: "text_1" });
            controller.enqueue({
              type: "model_usage",
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            });
            controller.enqueue({ type: "model_finish", finish_reason: "stop" });
          }
          controller.close();
        },
      });
    },
  };

  const result = await generate_model(model, {
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  }, {
    request_kind: "session_title",
    on_failure: (notice) => failures.push(notice),
  });

  assert.equal(call_count, 2);
  assert.equal(result.text, "done");
  assert.deepEqual(failures, [{
    request_kind: "session_title",
    code: "provider_timeout",
    message: "temporary timeout",
    retryable: true,
    attempt: 1,
    max_attempts: 6,
    will_retry: true,
  }]);
});

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

test("模型生成无效工具输入时向下一 Step 返回 failed tool_result", async () => {
  let executed = false;
  const model = {
    id: "invalid-tool-input-model",
    async stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "model_start", request_id: "request_1", model_id: "invalid-tool-input-model" });
          controller.enqueue({ type: "tool_call_start", content_id: "tool_1", tool_call_id: "call_1", tool_name: "write" });
          controller.enqueue({ type: "tool_call_delta", content_id: "tool_1", input_delta: "{\"content\":\"partial" });
          controller.enqueue({
            type: "tool_call_finish",
            content_id: "tool_1",
            input: {},
            input_error: "Tool call arguments are invalid JSON: Unterminated string",
          });
          controller.enqueue({ type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
          controller.enqueue({ type: "model_finish", finish_reason: "tool_call" });
          controller.close();
        },
      });
    },
  };

  const result = await run_model_step({
    model,
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "write" }] }],
    tools: { write: { execute: async () => { executed = true; } } },
    abort_signal: new AbortController().signal,
  });

  assert.equal(executed, false);
  assert.equal(result.step_result.tool_results[0].success, false);
  assert.match(result.step_result.tool_results[0].output.error, /invalid JSON/);
  assert.equal(result.assistant_parts[0].state, "failed");
});

test("Tool 返回 success false 时不会被标记为成功", async () => {
  const model = {
    id: "structured-tool-failure-model",
    async stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "model_start", request_id: "request_1", model_id: "structured-tool-failure-model" });
          controller.enqueue({ type: "tool_call_start", content_id: "tool_1", tool_call_id: "call_1", tool_name: "shell" });
          controller.enqueue({ type: "tool_call_finish", content_id: "tool_1", input: {} });
          controller.enqueue({ type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
          controller.enqueue({ type: "model_finish", finish_reason: "tool_call" });
          controller.close();
        },
      });
    },
  };

  const result = await run_model_step({
    model,
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "run" }] }],
    tools: { shell: { execute: async () => ({ success: false, exit_code: 1, error: "command failed" }) } },
    abort_signal: new AbortController().signal,
  });

  assert.equal(result.step_result.tool_results[0].success, false);
  assert.equal(result.assistant_parts[0].state, "failed");
});
