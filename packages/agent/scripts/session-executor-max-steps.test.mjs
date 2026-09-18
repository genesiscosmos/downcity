/**
 * @file 验证工具循环撞顶后先强制收尾，收尾仍无正文时按明确失败收口。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SessionExecutor } from "../bin/session/runner/SessionExecutor.js";
import {
  MAX_TOOL_LOOP_STEPS,
  TOOL_LOOP_MAX_STEPS_ERROR_CODE,
  build_max_steps_error_text,
} from "../bin/session/runner/SessionExecutorSignals.js";
import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

/**
 * 构造“每步都请求工具调用、禁用工具后才给正文”的模型。
 *
 * 关键点（中文）：收尾 Step 由 `call.tools` 为空识别，避免依赖 Step 序号假设。
 */
function create_tool_loop_model(wrap_up_text) {
  let provider_call_count = 0;
  const observed_calls = [];
  return {
    id: "tool-loop-limit-model",
    get provider_call_count() {
      return provider_call_count;
    },
    observed_calls,
    async stream(call) {
      provider_call_count += 1;
      const current_call = provider_call_count;
      const has_tools = (call.tools?.length ?? 0) > 0;
      observed_calls.push({ tool_count: call.tools?.length ?? 0 });
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "model_start",
            request_id: `request_${current_call}`,
            model_id: "tool-loop-limit-model",
          });
          if (has_tools) {
            controller.enqueue({
              type: "tool_call_start",
              content_id: `tool_${current_call}`,
              tool_call_id: `call_${current_call}`,
              tool_name: "ping",
            });
            controller.enqueue({
              type: "tool_call_finish",
              content_id: `tool_${current_call}`,
              input: {},
            });
            controller.enqueue({ type: "model_usage", usage });
            controller.enqueue({ type: "model_finish", finish_reason: "tool_call" });
          } else {
            if (wrap_up_text) {
              controller.enqueue({ type: "text_start", content_id: "wrap_text" });
              controller.enqueue({
                type: "text_delta",
                content_id: "wrap_text",
                delta: wrap_up_text,
              });
              controller.enqueue({ type: "text_finish", content_id: "wrap_text" });
            }
            controller.enqueue({ type: "model_usage", usage });
            controller.enqueue({ type: "model_finish", finish_reason: "stop" });
          }
          controller.close();
        },
      });
    },
  };
}

/** 创建一次可观测内部输入的 Turn 执行输入。 */
function create_turn_input(model) {
  const internal_parts = [];
  return {
    internal_parts,
    input: {
      turn_context: create_session_turn_context({
        session_id: "tool-loop-limit-session",
        session_origin: { type: "chat" },
        turn_id: "tool-loop-limit-turn",
        append_internal_user_message: async (parts) => {
          internal_parts.push(...parts);
          return { message_id: "internal", parts };
        },
      }),
      resolve_step_input: async () => ({
        model,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "keep going" }] }],
        tools: { ping: { execute: async () => ({ ok: true }) } },
      }),
    },
  };
}

function create_runner() {
  return new SessionExecutor({
    session_id: "tool-loop-limit-session",
    logger: { log: async () => {} },
    should_compact_on_error: () => false,
  });
}

test("工具循环上限提高到 1000", () => {
  assert.equal(MAX_TOOL_LOOP_STEPS, 1000);
});

test("撞顶后强制收尾一次，收尾无正文时返回明确失败", async () => {
  const model = create_tool_loop_model("");
  const turn = create_turn_input(model);

  const result = await create_runner().execute(turn.input);

  assert.equal(result.success, false);
  assert.equal(result.error_code, TOOL_LOOP_MAX_STEPS_ERROR_CODE);
  assert.equal(result.error, build_max_steps_error_text(MAX_TOOL_LOOP_STEPS));
  // 正常循环耗尽上限后，额外只允许一次禁用工具的收尾 Step。
  assert.equal(model.provider_call_count, MAX_TOOL_LOOP_STEPS + 1);
  assert.deepEqual(model.observed_calls.at(-1), { tool_count: 0 });
  assert.equal(turn.internal_parts.length, 1);
  assert.match(turn.internal_parts[0].text, /达到工具循环上限/);
});

test("撞顶后收尾成功时按成功收口并返回正文", async () => {
  const model = create_tool_loop_model("已完成的结论");
  const turn = create_turn_input(model);

  const result = await create_runner().execute(turn.input);

  assert.equal(result.success, true, result.error);
  assert.equal(result.error_code, undefined);
  assert.equal(result.text, "已完成的结论");
  assert.equal(model.provider_call_count, MAX_TOOL_LOOP_STEPS + 1);
  assert.deepEqual(model.observed_calls.at(-1), { tool_count: 0 });
});
