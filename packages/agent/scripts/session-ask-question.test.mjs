/**
 * @file 验证模型通过 ask_question Tool 在同一个 Session Turn 内等待并恢复执行。
 *
 * 关键点（中文）
 * - LLM 只返回标准 Tool Call，不依赖 Provider 私有的提问协议。
 * - Session 原子持久化 Question Interaction 与 waiting-user Tool 状态。
 * - 用户回答作为 Tool Result 返回模型，后续 Step 在同一个 Turn 中继续。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { Agent } from "@downcity/agent";
import { Workspace } from "@downcity/workspace";
import { create_agent_workspace } from "../bin/internal/index.js";
import { AskQuestionsTool } from "@downcity/agent/tools";

/** 构造 AI SDK V3 usage。 */
function create_usage() {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

/** 构造 ask_question Tool Call 模型流。 */
function create_question_stream() {
  const input = {
    title: "选择部署区域",
    questions: [
      {
        question: "需要部署到哪个区域？",
        type: "single_select",
        options: [
          { value: "cn", label: "中国" },
          { value: "us", label: "美国" },
        ],
      },
    ],
  };
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "tool-input-start",
          id: "call_ask_question",
          toolName: "ask_question",
        });
        controller.enqueue({
          type: "tool-input-delta",
          id: "call_ask_question",
          delta: JSON.stringify(input),
        });
        controller.enqueue({ type: "tool-input-end", id: "call_ask_question" });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_ask_question",
          toolName: "ask_question",
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

/** 构造收到回答后的最终文本流。 */
function create_final_text_stream() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({
          type: "text-delta",
          id: "text_1",
          delta: "将部署到中国区域。",
        });
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

test("Agent 默认不注册 ask_question", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-without-ask-question-"),
  );
  const agent = new Agent({ id: "agent_without_ask_question" });
  const entry = create_agent_workspace(agent, new Workspace({ id: "test_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));

  try {
    assert.equal("ask_question" in entry.tools, false);
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});

test("显式注入的 ask_question 等待回答并继续同一个 Turn", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-ask-question-"),
  );
  let stream_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "session-ask-question-model",
    doStream: async (options) => {
      if (!Array.isArray(options.tools) || options.tools.length === 0) {
        return create_final_text_stream();
      }
      stream_count += 1;
      return stream_count === 1
        ? create_question_stream()
        : create_final_text_stream();
    },
    doGenerate: async () => ({
      content: [{ type: "text", text: "Ask question test" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: create_usage(),
      warnings: [],
    }),
  });
  const agent = new Agent({
    id: "session_ask_question_agent",
    model,
    tools: {
      ask_question: AskQuestionsTool,
    },
  });
  const entry = create_agent_workspace(agent, new Workspace({ id: "test_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));

  try {
    assert.ok(entry.tools.ask_question);
    const session = await entry.sessions.create({
      session_id: "session_ask_question",
    });
    let pending_interaction;
    let response_result;
    const unsubscribe = session.subscribe((mutation) => {
      if (
        mutation.variant !== "part" ||
        mutation.type !== "interaction" ||
        mutation.part.status !== "pending" ||
        mutation.part.request.kind !== "question"
      ) return;
      pending_interaction = mutation.part;
      response_result = session.respond({
        interaction_id: mutation.part.interaction_id,
        response: {
          kind: "question",
          answers: [{
            question_id: pending_interaction.request.questions[0].question_id,
            value: "cn",
          }],
        },
      });
    });

    const turn = await session.prompt({ query: "帮我选择部署方案" });
    const result = await turn.finished;
    unsubscribe();

    assert.equal(result.success, true, result.error);
    assert.equal(result.text, "将部署到中国区域。");
    assert.equal(stream_count, 2);
    const messages = await session.messages();
    assert.ok(pending_interaction, JSON.stringify(messages.items, null, 2));
    assert.equal(pending_interaction.request.turn_id, turn.id);
    assert.deepEqual(await response_result, {
      status: "resolved",
      interaction_id: pending_interaction.interaction_id,
      response: {
        kind: "question",
        answers: [{
          question_id: pending_interaction.request.questions[0].question_id,
          value: "cn",
        }],
      },
    });

    const assistant_parts = messages.items.flatMap((message) =>
      message.type === "assistant" ? message.parts : []
    );
    const tool_part = assistant_parts.find(
      (part) => part.type === "tool" && part.tool_call_id === "call_ask_question",
    );
    const interaction_part = assistant_parts.find(
      (part) => part.type === "interaction" &&
        part.interaction_id === pending_interaction.interaction_id,
    );
    assert.equal(tool_part?.state, "completed");
    assert.deepEqual(tool_part?.output, {
      status: "resolved",
      answers: [{
        question_id: pending_interaction.request.questions[0].question_id,
        value: "cn",
      }],
    });
    assert.equal(interaction_part?.status, "resolved");
    assert.equal(interaction_part?.request.source.type, "tool");
    assert.equal(
      interaction_part?.request.source.tool_call_id,
      "call_ask_question",
    );
  } finally {
    await agent.dispose();
    await fs.rm(project_root, { recursive: true, force: true });
  }
});
