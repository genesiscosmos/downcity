/**
 * @file 验证 Session Tool Runtime 向 Shell 传递完整审批归属。
 *
 * 关键点（中文）
 * - 通过真实 Agent、Executor 与 Shell tool loop 发起 host 请求。
 * - approval Interaction 必须携带当前 Turn 与 Tool Call 标识。
 * - 用户批准后命令才执行，最终 Tool Part 收口为 completed。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";
import { Agent } from "@downcity/agent";
import { City, Workspace } from "@downcity/city";
import { Shell } from "@downcity/city";
import { create_test_sandbox_provider } from "./PlatformSandbox.mjs";

/** 构造 AI SDK V3 usage。 */
function create_usage() {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

/** 构造要求执行 host shell exec 动作的模型流。 */
function create_tool_call_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "tool-input-start",
          id: "call_host",
          toolName: "shell",
        });
        controller.enqueue({
          type: "tool-input-delta",
          id: "call_host",
          delta: JSON.stringify({
            action: "exec",
            args: {
              cmd: "printf approval-ok",
              shell: "/bin/sh",
              login: false,
              target: "host",
              reason: "验证 Session host 审批归属。",
            },
          }),
        });
        controller.enqueue({
          type: "tool-input-end",
          id: "call_host",
        });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_host",
          toolName: "shell",
          input: JSON.stringify({
            action: "exec",
            args: {
              cmd: "printf approval-ok",
              shell: "/bin/sh",
              login: false,
              target: "host",
              reason: "验证 Session host 审批归属。",
            },
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

test("host Shell 审批保留当前 Turn 并等待用户决定", async () => {
  const sandbox_provider = create_test_sandbox_provider();
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-shell-approval-"),
  );
  let stream_count = 0;
  const model = new MockModelClient({
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
  const workspace = new Workspace({
    id: "test_workspace",
    path: project_root, data_root_path: path.join(project_root, "data"),
    shell: new Shell({ sandbox_provider }),
  });
  // shell 属于 Workspace，但只在模型面以 City 注册的 `shell` power 暴露。
  const city = new City({ workspaces: [workspace] });
  city.agents.add(agent);
  await city.powers.settled();

  try {
    const session = await agent.sessions.create({
      session_id: "session_shell_approval",
      workspace,
    });
    let interaction_snapshot;
    let interaction_result;
    const unsubscribe = session.subscribe((mutation) => {
      // Tool Part 以 part Mutation 发布，Interaction 作为其从属数据一并到达。
      if (mutation.variant !== "part" || mutation.part.type !== "tool") return;
      const interaction = (mutation.part.interactions ?? []).find((item) =>
        item.interaction_type === "approval" &&
        item.status === "pending" &&
        item.request.type === "approval" &&
        item.request.source.type === "shell"
      );
      if (!interaction) return;
      interaction_snapshot = interaction;
      interaction_result = session.respond({
        interaction_id: interaction.interaction_id,
        response: { type: "approval", outcome: "resolved", payload: { decision: "approved" } },
      });
    });

    const turn = await session.prompt({ query: "run host command" });
    const result = await turn.finished;
    unsubscribe();

    assert.equal(result.success, true, result.error);
    assert.equal(stream_count, 2);
    const messages = await session.messages();
    const tool_part = messages.items
      .flatMap((message) => message.role === "agent" ? message.parts : [])
      .find((part) => part.type === "tool" && part.tool_call_id === "call_host");
    assert.ok(interaction_snapshot, JSON.stringify(messages.items));
    assert.equal(interaction_snapshot.request.turn_id, turn.id);
    assert.equal(interaction_snapshot.request.source.tool_call_id, "call_host");
    assert.deepEqual(await interaction_result, {
      status: "resolved",
      interaction_id: interaction_snapshot.interaction_id,
      response: { type: "approval", outcome: "resolved", payload: { decision: "approved" } },
    });
    assert.equal(tool_part?.state, "completed");
    // power 工具的统一信封把 shell 字段放在 data 内。
    assert.equal(tool_part?.output?.data?.output, "approval-ok");
  } finally {
    await city.close();
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});
