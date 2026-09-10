/**
 * @file 验证 CoreEngine 只根据真实 usage 请求 Composer Context Policy 恢复。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MockModelClient } from "./ModelClientMock.mjs";

import {
  resolve_model_usage_ratio,
  resolve_model_usage_tokens,
  should_compact_after_usage,
} from "../bin/executor/core-engine/CoreEngineContextCompaction.js";
import { CoreEngineRunner } from "../bin/executor/core-engine/CoreEngineRunner.js";
import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

function create_stream_text_result(text, input_tokens, output_tokens) {
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
            inputTokens: {
              total: input_tokens,
              noCache: input_tokens,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: output_tokens,
              text: output_tokens,
              reasoning: 0,
            },
          },
        });
        controller.close();
      },
    }),
  };
}

function create_runner() {
  return new CoreEngineRunner({
    session_id: "compact-runner-session",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
}

function create_context_error_runner() {
  return new CoreEngineRunner({
    session_id: "compact-runner-session",
    logger: { log: async () => {} },
    should_compact_on_error: (error) =>
      String(error || "").includes("context length"),
  });
}

function create_turn_input(model, messages, context_window = 100, warnings = []) {
  return {
    turn_context: create_session_turn_context({
      session_id: "compact-runner-session",
      session_origin: { type: "chat" },
      turn_id: "compact-runner-turn",
      report_model_request_failure: (warning) => warnings.push(warning),
    }),
    resolve_step_input: async () => ({
      model,
      system: [],
      messages,
      tools: {},
      context_window,
    }),
  };
}

test("usage 优先读取 totalTokens，并在缺失时回退 input + output", () => {
  assert.equal(
    resolve_model_usage_tokens({
      totalTokens: 95,
      inputTokens: 80,
      outputTokens: 10,
    }),
    95,
  );
  assert.equal(
    resolve_model_usage_tokens({ inputTokens: 80, outputTokens: 15 }),
    95,
  );
  assert.equal(resolve_model_usage_tokens({}), null);
});

test("真实 usage 达到 95% 时请求 Context Policy 恢复", () => {
  assert.equal(resolve_model_usage_ratio({ totalTokens: 94 }, 100), 0.94);
  assert.equal(should_compact_after_usage(0.94), false);
  assert.equal(should_compact_after_usage(0.95), true);
});

test("最终 Step 达到 95% 时通过 Turn 结果请求 writer 收口后持久化 compact", async () => {
  const model = new MockModelClient({
    modelId: "usage-trigger-model",
    doStream: async () => create_stream_text_result("done", 90, 5),
  });
  const result = await create_runner().execute(create_turn_input(model, [{
    role: "user",
    content: [{ type: "text", text: "latest request" }],
  }]));
  assert.equal(result.success, true, result.error);
  assert.equal(result.compact_required, true);
});

test("Provider 在输出前发生可重试流错误时自动重试", async () => {
  let call_count = 0;
  const warnings = [];
  const model = {
    id: "retryable-stream-model",
    async stream() {
      call_count += 1;
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: `request_${call_count}`,
            model_id: "retryable-stream-model",
          });
          if (call_count === 1) {
            controller.enqueue({
              type: "model_error",
              error: {
                code: "transport_error",
                message: "temporary disconnect",
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
  const messages = [{
    role: "user",
    content: [{ type: "text", text: "latest request" }],
  }];

  const result = await create_runner().execute(
    create_turn_input(model, messages, 100, warnings),
  );

  assert.equal(call_count, 2);
  assert.equal(result.success, true);
  assert.equal(result.text, "done");
  assert.deepEqual(warnings, [{
    request_kind: "turn",
    code: "transport_error",
    message: "temporary disconnect",
    retryable: true,
    attempt: 1,
    max_attempts: 6,
    will_retry: true,
  }]);
});

test("Provider 不可重试失败会立即发送最终模型 Warning", async () => {
  const warnings = [];
  const model = {
    id: "rejected-model",
    async stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: "request_rejected",
            model_id: "rejected-model",
          });
          controller.enqueue({
            type: "model_error",
            error: {
              code: "authentication_failed",
              message: "invalid model credential",
              retryable: false,
              provider_request_id: "provider_request_1",
            },
          });
          controller.close();
        },
      });
    },
  };
  const messages = [{
    role: "user",
    content: [{ type: "text", text: "latest request" }],
  }];

  const result = await create_runner().execute(
    create_turn_input(model, messages, 100, warnings),
  );

  assert.equal(result.success, false);
  assert.deepEqual(warnings, [{
    request_kind: "turn",
    code: "authentication_failed",
    message: "invalid model credential",
    retryable: false,
    attempt: 1,
    max_attempts: 1,
    will_retry: false,
    provider_request_id: "provider_request_1",
  }]);
});

test("每个 Provider Step 使用 Composer 返回的最新 canonical history", async () => {
  const provider_prompts = [];
  const compacted_messages = [{
    role: "assistant",
    content: [{ type: "text", text: "compacted checkpoint" }],
  }];
  const runner = new CoreEngineRunner({
    session_id: "compact-runner-session",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  const model = new MockModelClient({
    modelId: "history-reload-model",
    doStream: async (options) => {
      provider_prompts.push(JSON.stringify(options.prompt));
      return create_stream_text_result("done", 20, 5);
    },
  });
  const input = create_turn_input(model, [{
    role: "user",
    content: [{ type: "text", text: "history before compact" }],
  }]);
  input.resolve_step_input = async () => ({
    model,
    system: [],
    messages: compacted_messages,
    tools: {},
    context_window: 100,
  });

  const result = await runner.execute(input);

  assert.equal(result.success, true);
  assert.equal(provider_prompts.length, 1);
  assert.match(provider_prompts[0], /compacted checkpoint/);
  assert.doesNotMatch(provider_prompts[0], /history before compact/);
});

test("每个 Provider Step 只解析一次完整 Composer 输入", async () => {
  let provider_call_count = 0;
  let compose_count = 0;
  const model = {
    id: "single-compose-per-step-model",
    async stream() {
      provider_call_count += 1;
      const current_call = provider_call_count;
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: `request_${current_call}`,
            model_id: "single-compose-per-step-model",
          });
          if (current_call === 1) {
            controller.enqueue({
              type: "tool_call_start",
              content_id: "tool_1",
              tool_call_id: "call_1",
              tool_name: "ping",
            });
            controller.enqueue({
              type: "tool_call_finish",
              content_id: "tool_1",
              input: {},
            });
            controller.enqueue({
              type: "model_usage",
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            });
            controller.enqueue({
              type: "model_finish",
              finish_reason: "tool_call",
            });
          } else {
            controller.enqueue({ type: "text_start", content_id: "text_1" });
            controller.enqueue({
              type: "text_delta",
              content_id: "text_1",
              delta: "done",
            });
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
  const input = create_turn_input(model, [{
    role: "user",
    content: [{ type: "text", text: "ping" }],
  }]);
  input.resolve_step_input = async () => {
    compose_count += 1;
    return {
      model,
      system: [],
      messages: [{
        role: "user",
        content: [{ type: "text", text: "ping" }],
      }],
      tools: { ping: { execute: async () => "pong" } },
      context_window: 100,
    };
  };

  const result = await create_runner().execute(input);

  assert.equal(result.success, true, result.error);
  assert.equal(provider_call_count, 2);
  assert.equal(compose_count, 2);
});

test("Provider context-length error 交给外层 Composer 恢复策略", async () => {
  const model = new MockModelClient({
    modelId: "context-error-model",
    doStream: async () => { throw new Error("context length exceeded"); },
  });
  await assert.rejects(create_context_error_runner().execute(
    create_turn_input(model, [{
      role: "user",
      content: [{ type: "text", text: "latest request" }],
    }]),
  ), /context length exceeded/);
});
