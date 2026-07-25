/**
 * @file 验证 Session 标题会进入 subscribe 事件与 history session 信息。
 *
 * 关键点（中文）
 * - 这里走编译后的公开 SDK，锁住调用方实际可见行为。
 * - title 默认允许为空；没有可用模型时不会再回退成首条 user message。
 * - 当后续补上模型且 title 仍为空时，应允许再次尝试生成。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { MockLanguageModelV3 } from "ai/test";
import { Agent, Workspace } from "../bin/index.js";

function create_stream_text_result(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [],
        });
        controller.enqueue({
          type: "text-start",
          id: "text_1",
        });
        controller.enqueue({
          type: "text-delta",
          id: "text_1",
          delta: text,
        });
        controller.enqueue({
          type: "text-end",
          id: "text_1",
        });
        controller.enqueue({
          type: "finish",
          finishReason: {
            unified: "stop",
            raw: "stop",
          },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 0,
              text: 0,
              reasoning: 0,
            },
          },
        });
        controller.close();
      },
    }),
  };
}

function create_mock_title_model(title_text) {
  return new MockLanguageModelV3({
    modelId: "mock-session-title-model",
    doStream: async () => create_stream_text_result(title_text),
  });
}

function create_failing_title_model() {
  return new MockLanguageModelV3({
    modelId: "mock-session-title-failing-model",
    doStream: async () => {
      throw new Error("mock title generation failed");
    },
  });
}

async function read_log_lines(agent_path) {
  const logs_path = path.join(agent_path, ".downcity", "logs");
  const entries = await fs.readdir(logs_path);
  const lines = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const content = await fs.readFile(path.join(logs_path, entry), "utf8");
    lines.push(...content.split("\n").filter(Boolean));
  }
  return lines;
}

test("Session keeps title empty when no model is available", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-"),
  );
  const agent = new Agent({
    id: "title_agent",
    workspace: new Workspace({ path: agent_path }),
  });
  const session = await agent.sessions.create();
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
  });

  try {
    await session.append_user_message({
      text: "Use shell tools to inspect the current workspace",
    });

    assert.equal(
      events.some(
        (event) => event.variant === "message" && event.type === "user",
      ),
      true,
    );
    assert.equal((await session.get_info()).title, undefined);
  } finally {
    unsubscribe();
    await agent.dispose();
  }
});

test("Session logs title generation failure without blocking the session", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-log-"),
  );
  const agent = new Agent({
    id: "title_log_agent",
    workspace: new Workspace({ path: agent_path }),
    model: create_failing_title_model(),
  });
  const session = await agent.sessions.create();
  await session.set({ model: create_failing_title_model() });

  try {
    await session.append_user_message({
      text: "Diagnose why session title generation is flaky",
    });

    assert.equal((await session.get_info()).title, undefined);

    await agent.get_logger().save_all_logs();
    const log_lines = await read_log_lines(agent_path);
    const title_failure_log = log_lines
      .map((line) => JSON.parse(line))
      .find((entry) => entry.message.includes("session_title.generate_failed"));

    assert.ok(title_failure_log);
    assert.equal(title_failure_log.type, "warn");
    assert.equal(title_failure_log.details.session_id, session.id);
    assert.equal(
      title_failure_log.details.model_label,
      "mock-session-title-failing-model",
    );
    assert.equal(
      title_failure_log.details.message,
      "mock title generation failed",
    );
    assert.equal(
      title_failure_log.details.firstUserTextLength,
      "Diagnose why session title generation is flaky".length,
    );
  } finally {
    await agent.dispose();
  }
});

test("Session retries title generation after model becomes available", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-retry-"),
  );
  const agent = new Agent({
    id: "title_retry_agent",
    workspace: new Workspace({ path: agent_path }),
  });
  const session = await agent.sessions.create();
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
  });

  try {
    await session.append_user_message({
      text: "Investigate flaky session title generation in the SDK",
    });

    assert.equal((await session.get_info()).title, undefined);

    await session.set({
      model: create_mock_title_model("排查 session 标题"),
    });
    await session.append_user_message({
      text: "Need another prompt to trigger the retry path",
    });

    assert.equal((await session.get_info()).title, "排查 session 标题");
  } finally {
    unsubscribe();
    await agent.dispose();
  }
});
