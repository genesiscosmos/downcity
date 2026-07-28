/**
 * @file 验证执行器失败结果不会伪造 Assistant 正文。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";

import { CoreEngineRunner } from "../bin/executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "../bin/executor/services/ExecutorRecoveryPolicy.js";
import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

function create_turn_context(overrides = {}) {
  return create_session_turn_context({
    session_id: "executor-failure-test",
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
    id: "user-1",
    role: "user",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "executor-failure-test",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "hello" }],
  }];
  return {
    execute_input: { query: "hello", system: [], messages, tools: {} },
    model,
    turn_context,
    resolve_step_inputs: async () => ({ model, system: [], tools: {} }),
    reload_history: async () => messages,
  };
}

test("CoreEngine Provider 失败时只返回结构化错误", async () => {
  const model = new MockLanguageModelV3({
    modelId: "failing-model",
    doStream: async () => {
      throw new Error("quota exceeded");
    },
  });
  const runner = new CoreEngineRunner({
    session_id: "executor-failure-test",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  const messages = [{
    id: "user-1",
    role: "user",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "executor-failure-test",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "hello" }],
  }];

  const result = await runner.execute({
    execute_input: { query: "hello", system: [], messages, tools: {} },
    model,
    turn_context: create_turn_context(),
    resolve_step_inputs: async () => ({ model, system: [], tools: {} }),
    reload_history: async () => messages,
  });

  assert.equal(result.success, false);
  assert.match(result.error, /quota exceeded/);
  assert.equal(result.text, "");
});

test("CoreEngine 成功流按 start、chunks、finish 完成 canonical step", async () => {
  const events = [];
  const model = new MockLanguageModelV3({
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
        write_chunk: async (chunk) => events.push(chunk.type),
        finish_step: async (message) => {
          events.push(`finish:${message.parts.map((part) => part.type).join(",")}`);
        },
        abort_step: async () => events.push("abort"),
      },
    }),
  ));

  assert.equal(result.success, true);
  assert.equal(events[0], "start");
  assert.equal(events.includes("text-delta"), true);
  assert.match(events.at(-1), /^finish:/);
  assert.equal(events.includes("abort"), false);
});

test("CoreEngine chunk 写入失败时中止 canonical step", async () => {
  const events = [];
  const model = new MockLanguageModelV3({
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
        write_chunk: async () => {
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
    should_compact: () => false,
  });
  const turn_context = create_turn_context();
  const result = await policy.execute_with_retry({
    query: "hello",
    model: {},
    turn_context,
    prepare_execute_input: async () => {
      throw new Error("configuration failed");
    },
    execute_prepared_input: async () => {
      throw new Error("unexpected execution");
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /configuration failed/);
  assert.equal(result.assistant_message, undefined);
});
