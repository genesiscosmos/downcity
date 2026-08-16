/**
 * @file 验证 AI SDK Tool needsApproval 接入 Session Interaction。
 *
 * 关键点（中文）
 * - Tool 自己声明审批意图，Agent 不持有审批配置。
 * - Runtime 展示真实 Tool Call，用户响应后继续原 Turn。
 * - 拒绝时 Tool execute 不能产生副作用。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { Agent, Workspace } from "@downcity/agent";

function create_usage() {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

function create_tool_call_stream() {
  const input = { value: "approval-value" };
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "tool-input-start",
          id: "call_custom_approval",
          toolName: "custom_approval",
        });
        controller.enqueue({
          type: "tool-input-delta",
          id: "call_custom_approval",
          delta: JSON.stringify(input),
        });
        controller.enqueue({ type: "tool-input-end", id: "call_custom_approval" });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_custom_approval",
          toolName: "custom_approval",
          input: JSON.stringify(input),
        });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: create_usage(),
        });
        controller.close();
      },
    }),
  };
}

function create_final_text_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({ type: "text-delta", id: "text_1", delta: "finished" });
        controller.enqueue({ type: "text-end", id: "text_1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: create_usage(),
        });
        controller.close();
      },
    }),
  };
}

async function run_approval_case(decision) {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-native-tool-approval-"),
  );
  let execution_count = 0;
  let tool_stream_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "native-tool-approval-model",
    doStream: async (options) => {
      if (!Array.isArray(options.tools) || options.tools.length === 0) {
        return create_final_text_stream();
      }
      tool_stream_count += 1;
      return tool_stream_count === 1
        ? create_tool_call_stream()
        : create_final_text_stream();
    },
    doGenerate: async () => ({
      content: [{ type: "text", text: "Approval test" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: create_usage(),
      warnings: [],
    }),
  });
  const agent = new Agent({
    id: `native_tool_approval_${decision}`,
    model,
    tools: {
      custom_approval: {
        description: "Execute a custom operation after approval.",
        inputSchema: z.object({ value: z.string() }),
        needsApproval: true,
        execute: async () => {
          execution_count += 1;
          return "tool-result";
        },
      },
    },
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));

  try {
    const session = await entry.sessions.create({ session_id: "tool_approval" });
    let pending_request;
    let response_promise;
    const unsubscribe = session.subscribe((mutation) => {
      if (
        mutation.variant !== "part" ||
        mutation.type !== "interaction" ||
        mutation.part.status !== "pending" ||
        mutation.part.request.kind !== "approval" ||
        mutation.part.request.operation !== "tool"
      ) return;
      pending_request = mutation.part.request;
      response_promise = session.respond({
        interaction_id: mutation.part.interaction_id,
        response: { kind: "approval", decision },
      });
    });

    const turn = await session.prompt({ query: "run custom approval tool" });
    const result = await turn.finished;
    unsubscribe();

    assert.equal(result.success, true, result.error);
    assert.equal(result.text, "finished");
    assert.equal(execution_count, decision === "approved" ? 1 : 0);
    assert.ok(pending_request);
    assert.equal(pending_request.source.tool_name, "custom_approval");
    assert.deepEqual(pending_request.validated_input, {
      value: "approval-value",
    });
    assert.equal(
      pending_request.tool_description,
      "Execute a custom operation after approval.",
    );
    assert.equal("title" in pending_request, false);
    assert.equal("reason" in pending_request, false);
    assert.ok(response_promise);
    await response_promise;
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
}

test("needsApproval 批准后执行 Tool 并恢复原 Turn", async () => {
  await run_approval_case("approved");
});

test("needsApproval 拒绝后不执行 Tool 副作用", async () => {
  await run_approval_case("denied");
});
