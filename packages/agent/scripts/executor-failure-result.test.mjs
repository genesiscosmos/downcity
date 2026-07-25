/**
 * @file 验证执行器失败结果不会伪造 Assistant 正文。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";

import { CoreEngineRunner } from "../bin/executor/core-engine/CoreEngineRunner.js";
import { ExecutorRecoveryPolicy } from "../bin/executor/services/ExecutorRecoveryPolicy.js";

function create_run_context(overrides = {}) {
  return {
    session_id: "executor-failure-test",
    injected_user_messages: [],
    deferred_persisted_user_messages: [],
    pending_assistant_file_parts: [],
    ...overrides,
  };
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

function create_runner_input(model, run_context) {
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
    run_context,
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

  const result = await runner.run({
    execute_input: { query: "hello", system: [], messages, tools: {} },
    model,
    run_context: create_run_context(),
    resolve_step_inputs: async () => ({ model, system: [], tools: {} }),
    reload_history: async () => messages,
  });

  assert.equal(result.success, false);
  assert.match(result.error, /quota exceeded/);
  assert.equal(result.assistant_message, undefined);
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
  const result = await runner.run(create_runner_input(
    model,
    create_run_context({
      on_ui_message_step_start: async () => events.push("start"),
      on_ui_message_chunk_callback: async (chunk) => events.push(chunk.type),
      on_ui_message_step_finish: async (message) => {
        events.push(`finish:${message.parts.map((part) => part.type).join(",")}`);
      },
      on_ui_message_step_abort: async () => events.push("abort"),
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
  const result = await runner.run(create_runner_input(
    model,
    create_run_context({
      on_ui_message_step_start: async () => events.push("start"),
      on_ui_message_chunk_callback: async () => {
        throw new Error("canonical write failed");
      },
      on_ui_message_step_finish: async () => events.push("finish"),
      on_ui_message_step_abort: async () => events.push("abort"),
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
  const run_context = create_run_context();
  const result = await policy.run_with_retry({
    query: "hello",
    model: {},
    run_context,
    prepare_execute_input: async () => {
      throw new Error("configuration failed");
    },
    execute_prepared_run: async () => {
      throw new Error("unexpected execution");
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /configuration failed/);
  assert.equal(result.assistant_message, undefined);
});
