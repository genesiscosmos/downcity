/**
 * @file 验证执行器失败结果不会伪造 Assistant 正文。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MockModelClient } from "./ModelClientMock.mjs";

import { CoreEngineRunner } from "../bin/executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "../bin/executor/services/ExecutorRecoveryPolicy.js";
import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

function create_turn_context(overrides = {}) {
  return create_session_turn_context({
    session_id: "executor-failure-test",
    session_origin: { type: "chat" },
    turn_id: "executor-failure-turn",
    ...overrides,
  });
}

function create_text_stream(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text-1" });
        controller.enqueue({ type: "text-delta", id: "text-1", delta: text });
        controller.enqueue({ type: "text-end", id: "text-1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  };
}

function create_execution_input(model, turn_context) {
  const messages = [{
    role: "user",
    content: [{ type: "text", text: "hello" }],
  }];
  return {
    turn_context,
    resolve_step_input: async () => ({
      model,
      system: [],
      messages,
      tools: {},
    }),
  };
}

test("CoreEngine Provider 失败时只返回结构化错误", async () => {
  const model = {
    id: "failing-model",
    async stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: "request_1",
            model_id: "failing-model",
          });
          controller.enqueue({
            type: "model_error",
            error: {
              code: "permission_denied",
              message: "quota exceeded",
              retryable: false,
            },
          });
          controller.close();
        },
      });
    },
  };
  const runner = new CoreEngineRunner({
    session_id: "executor-failure-test",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  const messages = [{
    role: "user",
    content: [{ type: "text", text: "hello" }],
  }];

  const result = await runner.execute({
    turn_context: create_turn_context(),
    resolve_step_input: async () => ({
      model,
      system: [],
      messages,
      tools: {},
    }),
  });

  assert.equal(result.success, false);
  assert.match(result.error, /quota exceeded/);
  assert.equal(result.text, "");
});

test("CoreEngine 成功流按 start、chunks、finish 完成 canonical step", async () => {
  const events = [];
  const model = new MockModelClient({
    modelId: "canonical-step-model",
    doStream: async () => create_text_stream("done"),
  });
  const runner = new CoreEngineRunner({
    session_id: "executor-failure-test",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  const result = await runner.execute(create_execution_input(
    model,
    create_turn_context({
      assistant_output: {
        begin_step: async () => events.push("start"),
        write_model_event: async (event) => events.push(event.type),
        finish_step: async (parts) => {
          events.push(`finish:${parts.map((part) => part.type).join(",")}`);
        },
        abort_step: async () => events.push("abort"),
      },
    }),
  ));

  assert.equal(result.success, true);
  assert.equal(events[0], "start");
  assert.equal(events.includes("text_delta"), true);
  assert.match(events.at(-1), /^finish:/);
  assert.equal(events.includes("abort"), false);
});

test("CoreEngine chunk 写入失败时中止 canonical step", async () => {
  const events = [];
  const model = new MockModelClient({
    modelId: "canonical-step-failure-model",
    doStream: async () => create_text_stream("partial"),
  });
  const runner = new CoreEngineRunner({
    session_id: "executor-failure-test",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  const result = await runner.execute(create_execution_input(
    model,
    create_turn_context({
      assistant_output: {
        begin_step: async () => events.push("start"),
        write_model_event: async () => {
          throw new Error("canonical write failed");
        },
        finish_step: async () => events.push("finish"),
        abort_step: async () => events.push("abort"),
      },
    }),
  ));

  assert.equal(result.success, false);
  assert.match(result.error, /canonical write failed/);
  assert.deepEqual(events, ["start", "abort"]);
});

test("恢复策略捕获普通异常后只返回结构化错误", async () => {
  const policy = new ExecutorRecoveryPolicy({
    session_id: "executor-failure-test",
    logger: { log: async () => {} },
    recover_context: async () => false,
  });
  const result = await policy.execute_with_retry({
    execute_turn: async () => {
      throw new Error("configuration failed");
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /configuration failed/);
  assert.equal(result.assistant_message, undefined);
});
