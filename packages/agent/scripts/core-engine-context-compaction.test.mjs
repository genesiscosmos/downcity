/**
 * @file 验证 CoreEngine 基于真实 usage 的触发水位与 part/tool transaction 深度折叠。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";

import {
  deep_compact_model_messages,
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

function create_turn_input(model, messages, context_window = 100) {
  return {
    execute_input: {
      query: "latest request",
      system: [],
      messages,
      tools: {},
    },
    model,
    turn_context: create_session_turn_context({
      session_id: "compact-runner-session",
      turn_id: "compact-runner-turn",
    }),
    resolve_step_inputs: async () => ({
      model,
      system: [],
      tools: {},
      context_window,
    }),
    reload_history: async () => messages,
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

test("普通调用使用 95% 触发，compact 验收使用 50% 目标", () => {
  assert.equal(resolve_model_usage_ratio({ totalTokens: 94 }, 100), 0.94);
  assert.equal(should_compact_after_usage(0.94, false), false);
  assert.equal(should_compact_after_usage(0.95, false), true);
  assert.equal(should_compact_after_usage(0.5, true), false);
  assert.equal(should_compact_after_usage(0.5001, true), true);
});

test("最终 Step 达到 95% 时通过 Turn 结果请求 writer 收口后持久化 compact", async () => {
  const model = new MockLanguageModelV3({
    modelId: "usage-trigger-model",
    doStream: async () => create_stream_text_result("done", 90, 5),
  });
  const result = await create_runner().execute(create_turn_input(model, [{
    id: "user-1",
    role: "user",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "compact-runner-session",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "latest request" }],
  }]));
  assert.equal(result.success, true);
  assert.equal(result.compact_required, true);
});

test("新的持久化 Summary 只按 50% 水位验收一次", async () => {
  const model = new MockLanguageModelV3({
    modelId: "usage-validation-model",
    doStream: async () => create_stream_text_result("done", 55, 5),
  });
  const runner = create_runner();
  const messages = [{
    id: "summary-1",
    role: "assistant",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "compact-runner-session",
      source: "compact",
      kind: "summary",
    },
    parts: [{ type: "text", text: "previous checkpoint" }],
  }, {
    id: "user-1",
    role: "user",
    metadata: {
      v: 1,
      ts: 2,
      session_id: "compact-runner-session",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "latest request" }],
  }];
  const first = await runner.execute(create_turn_input(model, messages));
  const second = await runner.execute(create_turn_input(model, messages));
  assert.equal(first.compact_required, true);
  assert.equal(second.compact_required, undefined);
});

test("显式 compact 后在下一次 provider 调用前重载 canonical history", async () => {
  const provider_prompts = [];
  const compacted_records = [{
    id: "summary-reloaded",
    role: "assistant",
    metadata: {
      v: 1,
      ts: 2,
      session_id: "compact-runner-session",
      source: "compact",
      kind: "summary",
    },
    parts: [{ type: "text", text: "compacted checkpoint" }],
  }];
  const runner = new CoreEngineRunner({
    session_id: "compact-runner-session",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
  let reload_requested = true;
  const model = new MockLanguageModelV3({
    modelId: "history-reload-model",
    doStream: async (options) => {
      provider_prompts.push(JSON.stringify(options.prompt));
      return create_stream_text_result("done", 20, 5);
    },
  });
  const input = create_turn_input(model, [{
    id: "old-user",
    role: "user",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "compact-runner-session",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "history before compact" }],
  }]);
  input.turn_context = create_session_turn_context({
    session_id: "compact-runner-session",
    turn_id: "compact-runner-turn",
    consume_history_reload: () => {
      const requested = reload_requested;
      reload_requested = false;
      return requested;
    },
  });
  input.reload_history = async () => compacted_records;

  const result = await runner.execute(input);

  assert.equal(result.success, true);
  assert.equal(provider_prompts.length, 1);
  assert.match(provider_prompts[0], /compacted checkpoint/);
  assert.doesNotMatch(provider_prompts[0], /history before compact/);
});

test("Provider context-length error 在当前 tool-loop 内 deep compact 后重试", async () => {
  let provider_calls = 0;
  const model = new MockLanguageModelV3({
    modelId: "context-error-model",
    doStream: async () => {
      provider_calls += 1;
      if (provider_calls === 1) throw new Error("context length exceeded");
      return create_stream_text_result("recovered", 40, 5);
    },
  });
  const result = await create_context_error_runner().execute(
    create_turn_input(model, [{
      id: "user-1",
      role: "user",
      metadata: {
        v: 1,
        ts: 1,
        session_id: "compact-runner-session",
        source: "ingress",
        kind: "normal",
      },
      parts: [{ type: "text", text: "latest request" }],
    }]),
  );
  assert.equal(result.success, true);
  assert.equal(result.compact_required, true);
  assert.equal(provider_calls, 2);
});

test("deep compact 删除 reasoning，并完整保留最新并行 tool transaction", () => {
  const large_output = "tool-output-".repeat(8_000);
  const messages = [
    { role: "user", content: "older request" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "old reasoning".repeat(2_000) },
        {
          type: "tool-call",
          toolCallId: "old-call",
          toolName: "old_tool",
          input: { query: "old" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "old-call",
          toolName: "old_tool",
          output: { type: "text", value: large_output },
        },
      ],
    },
    { role: "user", content: "latest request" },
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "latest reasoning".repeat(2_000),
          providerOptions: { openai: { itemId: "rs_latest" } },
        },
        {
          type: "text",
          text: "running tools",
          providerOptions: {
            openai: { itemId: "msg_latest", phase: "final_answer" },
          },
        },
        {
          type: "tool-call",
          toolCallId: "call-a",
          toolName: "tool_a",
          input: { value: "a" },
          providerOptions: { openai: { itemId: "fc_a" } },
        },
        {
          type: "tool-call",
          toolCallId: "call-b",
          toolName: "tool_b",
          input: { value: "b" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-a",
          toolName: "tool_a",
          output: { type: "text", value: large_output },
          providerOptions: { openai: { resultId: "result_a" } },
        },
        {
          type: "tool-result",
          toolCallId: "call-b",
          toolName: "tool_b",
          output: { type: "json", value: { large_output } },
        },
      ],
    },
  ];

  const compacted = deep_compact_model_messages(messages, 0);
  const serialized = JSON.stringify(compacted);
  assert.equal(serialized.includes("old reasoning"), false);
  assert.equal(serialized.includes("latest reasoning"), false);
  assert.equal(serialized.includes('"itemId":"rs_latest"'), false);
  assert.equal(serialized.includes('"itemId":"msg_latest"'), false);
  assert.equal(serialized.includes('"phase":"final_answer"'), false);
  assert.equal(serialized.includes("latest request"), true);
  assert.equal(serialized.includes("call-a"), true);
  assert.equal(serialized.includes("call-b"), true);
  assert.ok(serialized.length < JSON.stringify(messages).length / 2);

  const tool_call_ids = new Set();
  const tool_result_ids = new Set();
  const active_tool_text = [];
  for (const message of compacted) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") tool_call_ids.add(part.toolCallId);
      if (part.type === "tool-result") tool_result_ids.add(part.toolCallId);
      if (part.type === "tool-call" || part.type === "tool-result") {
        active_tool_text.push(JSON.stringify(part));
      }
    }
  }
  assert.equal(active_tool_text.join("\n").includes("old-call"), false);
  assert.deepEqual([...tool_call_ids].sort(), ["call-a", "call-b"]);
  assert.deepEqual([...tool_result_ids].sort(), ["call-a", "call-b"]);
  assert.equal(serialized.includes('"itemId":"fc_a"'), false);
  assert.equal(serialized.includes('"resultId":"result_a"'), false);
});

test("单条 assistant 含大量 parts 时也会在消息内部折叠", () => {
  const messages = [{
    role: "assistant",
    content: Array.from({ length: 40 }, (_, index) => ({
      type: "text",
      text: `part-${String(index)}:${"x".repeat(4_000)}`,
    })),
  }];
  const compacted = deep_compact_model_messages(messages, 0);
  assert.equal(compacted.length, 1);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(messages).length / 4);
});

test("tool approval request/response 与对应 call 一起保留且不产生孤儿", () => {
  const compacted = deep_compact_model_messages([
    { role: "user", content: "approve the operation" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "approval-call",
          toolName: "dangerous_tool",
          input: { path: "/tmp/example" },
        },
        {
          type: "tool-approval-request",
          toolCallId: "approval-call",
          approvalId: "approval-1",
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "approval-1",
          approved: true,
          providerExecuted: true,
        },
      ],
    },
  ]);
  const serialized = JSON.stringify(compacted);
  assert.equal(serialized.includes('"toolCallId":"approval-call"'), true);
  assert.equal(serialized.includes('"approvalId":"approval-1"'), true);
  assert.equal(serialized.includes('"approved":true'), true);
});
