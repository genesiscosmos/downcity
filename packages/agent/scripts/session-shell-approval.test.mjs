/**
 * @file 验证 Session Tool Runtime 向 Shell 传递完整审批归属。
 *
 * 关键点（中文）
 * - 通过真实 Agent、Executor 与 Shell tool loop 发起 unrestricted 请求。
 * - approval Interaction 必须携带当前 Turn 与 Tool Call 标识。
 * - 用户批准后命令才执行，最终 Tool Part 收口为 completed。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { Agent, Workspace } from "@downcity/agent";
import { Shell } from "@downcity/shell";
import { create_platform_sandbox } from "./PlatformSandbox.mjs";

/** 构造 AI SDK V3 usage。 */
function create_usage() {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

/** 构造要求执行 unrestricted shell_exec 的模型流。 */
function create_tool_call_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "tool-input-start",
          id: "call_unrestricted",
          toolName: "shell_exec",
        });
        controller.enqueue({
          type: "tool-input-delta",
          id: "call_unrestricted",
          delta: JSON.stringify({
            cmd: "printf approval-ok",
            shell: "/bin/sh",
            login: false,
            sandbox: "unrestricted",
            reason: "验证 Session unrestricted 审批归属。",
          }),
        });
        controller.enqueue({
          type: "tool-input-end",
          id: "call_unrestricted",
        });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_unrestricted",
          toolName: "shell_exec",
          input: JSON.stringify({
            cmd: "printf approval-ok",
            shell: "/bin/sh",
            login: false,
            sandbox: "unrestricted",
            reason: "验证 Session unrestricted 审批归属。",
          }),
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

/** 构造 Tool 执行后的最终文本流。 */
function create_final_text_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({ type: "text-delta", id: "text_1", delta: "done" });
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

test("unrestricted Shell 审批保留当前 Turn 并等待用户决定", async () => {
  const sandbox = await create_platform_sandbox();
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-shell-approval-"),
  );
  let stream_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "session-shell-approval-model",
    doStream: async (options) => {
      if (!Array.isArray(options.tools) || options.tools.length === 0) {
        return create_final_text_stream();
      }
      stream_count += 1;
      return stream_count === 1
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
    id: "session_shell_approval_agent",
    model,
  });
  const entry = agent.enter(new Workspace({
    id: "test_workspace",
    path: project_root,
    shell: new Shell({ sandbox }),
  }));

  try {
    const session = await entry.sessions.create({
      session_id: "session_shell_approval",
    });
    let interaction_snapshot;
    let interaction_result;
    const unsubscribe = session.subscribe((mutation) => {
      if (
        mutation.variant !== "part" ||
        mutation.type !== "interaction" ||
        mutation.part.interaction_type !== "approval" ||
        mutation.part.status !== "pending" ||
        mutation.part.request.kind !== "approval" ||
        mutation.part.request.source.type !== "tool"
      ) return;
      interaction_snapshot = mutation.part;
      interaction_result = session.respond({
        interaction_id: mutation.part.interaction_id,
        response: { kind: "approval", decision: "approved" },
      });
    });

    const turn = await session.prompt({ query: "run unrestricted command" });
    const result = await turn.finished;
    unsubscribe();

    assert.equal(result.success, true, result.error);
    assert.equal(stream_count, 2);
    const messages = await session.messages();
    const tool_part = messages.items
      .flatMap((message) => message.type === "assistant" ? message.parts : [])
      .find((part) => part.type === "tool" && part.tool_call_id === "call_unrestricted");
    assert.ok(interaction_snapshot, JSON.stringify(messages.items));
    assert.equal(interaction_snapshot.request.turn_id, turn.id);
    assert.equal(interaction_snapshot.request.source.tool_call_id, "call_unrestricted");
    assert.deepEqual(await interaction_result, {
      status: "resolved",
      interaction_id: interaction_snapshot.interaction_id,
      response: { kind: "approval", decision: "approved" },
    });
    assert.equal(tool_part?.state, "completed");
    assert.equal(tool_part?.output?.output, "approval-ok");
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});
