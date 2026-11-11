/** 验证模型失败诊断贯穿日志、重试通知与 Session Warning，并保护部分输出。 */
import assert from "node:assert/strict";
import test from "node:test";
import { consume_model_stream } from "../bin/model/ModelStreamConsumer.js";
import { execute_model_request } from "../bin/model/ModelRequestRunner.js";
import { ModelStreamFailure, normalize_model_invocation_failure } from "../bin/model/ModelStreamFailure.js";
import { create_session_model_request_warning } from "../bin/session/messages/SessionModelRequestWarning.js";

const call = { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] };
const model_error = {
  code: "invalid_request", message: "Model request rejected", retryable: false,
  status_code: 400, provider_request_id: "req_test", provider_error_code: "unsupported_parameter",
  provider_error_param: "reasoning_effort", provider_error_reason: "Unsupported request parameter",
};

test("没有标准错误协议的 ModelClient 按 HTTP 状态分类，不把限流当参数拒绝", () => {
  for (const [status, code, retryable] of [[400, "invalid_request", false], [401, "authentication_failed", false],
    [403, "permission_denied", false], [404, "model_unavailable", false], [429, "rate_limited", true],
    [503, "provider_error", true], [504, "provider_timeout", true]]) {
    const error = normalize_model_invocation_failure(Object.assign(new Error("private body"), { status }), false);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal(error.status_code, status);
    assert.ok(!error.message.includes("private body"));
  }
});

for (const streamed of [false, true]) {
  test(`${streamed ? "流内" : "建连"}失败在日志及 Warning 中保留同一组安全诊断`, async () => {
    const diagnostics = [];
    const notices = [];
    const model = { id: "test", async stream() {
      if (!streamed) throw Object.assign(new Error("private raw body"), { model_error });
      return new ReadableStream({ start(controller) {
        controller.enqueue({ type: "model_start", model_id: "test", request_id: "req_test" });
        controller.enqueue({ type: "model_error", error: model_error });
        controller.close();
      } });
    } };
    await assert.rejects(execute_model_request({
      request_kind: "turn", on_failure: (notice) => notices.push(notice),
      execute_attempt: () => consume_model_stream(model, call, undefined, () => false, () => {}, (diagnostic) => diagnostics.push(diagnostic)),
    }), { message: "Model request rejected" });
    assert.deepEqual(diagnostics.at(-1).model_error, model_error);
    assert.equal(diagnostics.at(-1).stage, streamed ? "accepting" : "opening");
    assert.equal(notices.length, 1);
    const warning = create_session_model_request_warning({ session_id: "test", notice: notices[0] });
    for (const [key, value] of Object.entries(model_error)) assert.equal(warning[key], value);
    assert.equal(warning.will_retry, false);
    assert.ok(!JSON.stringify(diagnostics).includes("private raw body"));
  });
}

test("明确的无输出临时失败可以重试，已产生部分输出则立即结束", async () => {
  for (const partial of [false, true]) {
    let attempts = 0;
    const notices = [];
    const result = execute_model_request({ request_kind: "turn", on_failure: (notice) => notices.push(notice),
      execute_attempt: async () => {
        attempts += 1;
        if (attempts === 1) throw new ModelStreamFailure({ ...model_error, code: "rate_limited", retryable: true, status_code: 429 }, partial);
        return "done";
      },
    });
    if (partial) await assert.rejects(result, ModelStreamFailure);
    else assert.equal(await result, "done");
    assert.equal(attempts, partial ? 1 : 2);
    assert.equal(notices[0].will_retry, !partial);
    assert.equal(notices[0].provider_request_id, "req_test");
  }
});

test("取消模型请求不重试也不发布 Warning", async () => {
  const controller = new AbortController();
  controller.abort();
  let warnings = 0;
  await assert.rejects(execute_model_request({ request_kind: "turn", abort_signal: controller.signal,
    on_failure: () => { warnings += 1; }, execute_attempt: async () => {
      throw new ModelStreamFailure({ code: "cancelled", message: "Model request cancelled", retryable: false }, false);
    },
  }), ModelStreamFailure);
  assert.equal(warnings, 0);
});
