/** 验证 HTTP 与 SSE 错误分类一致、诊断脱敏以及明确的重试语义。 */
import assert from "node:assert/strict";
import test from "node:test";
import { create_openai_compatible_model } from "../bin/index.js";
import { read_model_error } from "@downcity/type";

const call = { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] };

/** 通过公开 ModelClient 入口模拟上游 HTTP 拒绝或 SSE 错误帧。 */
async function read_failure(detail, status_code, streamed = false, request_id = "req_test") {
  const model = create_openai_compatible_model({
    id: "test-model", upstream_model: "test-model",
    base_url: "https://provider.example/v1", api_key: "private_api_key",
    fetch: async () => new Response(streamed
      ? `data: ${JSON.stringify({ error: { ...detail, status_code } })}\n\n`
      : JSON.stringify({ error: detail }), {
      status: streamed ? 200 : status_code,
      headers: { "x-request-id": request_id },
    }),
  });
  if (streamed) {
    const events = [];
    for await (const event of await model.stream(call)) events.push(event);
    assert.equal(events.at(-1).type, "model_error");
    return events.at(-1).error;
  }
  try {
    await model.stream(call);
    assert.fail("Expected upstream rejection");
  } catch (error) {
    assert.ok(error.model_error);
    return error.model_error;
  }
}

for (const [status_code, upstream_code, code, retryable] of [
  [400, "unsupported_parameter", "invalid_request", false],
  [401, "invalid_api_key", "authentication_failed", false],
  [403, "permission_error", "permission_denied", false],
  [404, "model_not_found", "model_unavailable", false],
  [429, "rate_limit_exceeded", "rate_limited", true],
  [503, "server_error", "provider_error", true],
  [504, "upstream_timeout", "provider_timeout", true],
  [400, "content_policy_violation", "content_rejected", false],
]) {
  test(`HTTP/SSE ${upstream_code} 保留相同分类、状态及重试语义`, async () => {
    const detail = { code: upstream_code, param: "reasoning_effort", message: "private prompt private_api_key" };
    const http = await read_failure(detail, status_code);
    const streamed = await read_failure(detail, status_code, true);
    assert.deepEqual(streamed, http);
    assert.equal(http.code, code);
    assert.equal(http.retryable, retryable);
    assert.equal(http.status_code, status_code);
    assert.equal(http.provider_error_code, upstream_code);
    assert.equal(http.provider_error_param, "reasoning_effort");
    assert.equal(http.provider_request_id, "req_test");
    assert.ok(!JSON.stringify(http).includes("private prompt"));
    assert.deepEqual(read_model_error(http), http);
  });
}

test("不带 HTTP 状态的 SSE 限流与临时故障仍能正确分类", async () => {
  for (const [upstream_code, expected] of [["rate_limit_error", "rate_limited"], ["overloaded_error", "provider_error"], ["timeout_error", "provider_timeout"]]) {
    const error = await read_failure({ type: upstream_code }, undefined, true);
    assert.equal(error.code, expected);
    assert.equal(error.retryable, true);
    assert.equal(error.status_code, undefined);
  }
  const typed = await read_failure({ code: "vendor_busy", type: "overloaded_error" }, undefined, true);
  assert.equal(typed.code, "provider_error");
  assert.equal(typed.provider_error_code, "vendor_busy");
  assert.equal(typed.retryable, true);
});

test("未知拒绝不推测可重试；原因摘要不复制原始正文", async () => {
  const error = await read_failure({ code: "unsupported_parameter", param: "messages[0].content", message: "Unsupported parameter: private prompt private_api_key" }, 400);
  assert.equal(error.message, "Model request rejected");
  assert.equal(error.retryable, false);
  assert.equal(error.provider_error_reason, "Unsupported request parameter");
  assert.ok(!JSON.stringify(error).includes("private prompt"));
  const unknown = await read_failure({ message: "private prompt" }, 422);
  assert.equal(unknown.code, "invalid_request");
  assert.equal(unknown.provider_error_reason, undefined);
});

test("诊断标识中包含凭据时丢弃，协议解码拒绝自由文本原因", async () => {
  for (const streamed of [false, true]) {
    const error = await read_failure({ code: "private_api_key", param: "private_api_key" }, 400, streamed, "req_private_api_key");
    assert.ok(!JSON.stringify(error).includes("private_api_key"));
  }
  const error = read_model_error({ code: "invalid_request", retryable: true,
    provider_error_code: "private trace with spaces", provider_error_param: "https://private.example",
    provider_error_reason: "private prompt", message: "private prompt" });
  assert.deepEqual(error, { code: "invalid_request", message: "Model request rejected", retryable: false });
});
