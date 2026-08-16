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

function create_delayed_title_model(title_text) {
  let resolve_started;
  let resolve_release;
  const started = new Promise((resolve) => {
    resolve_started = resolve;
  });
  const released = new Promise((resolve) => {
    resolve_release = resolve;
  });
  const model = new MockLanguageModelV3({
    modelId: "mock-session-title-delayed-model",
    doStream: async () => {
      resolve_started();
      await released;
      return create_stream_text_result(title_text);
    },
  });
  return {
    model,
    started,
    release: () => resolve_release(),
  };
}

async function read_log_lines(data_path) {
  const logs_path = path.join(data_path, "logs");
  const entries = await fs.readdir(logs_path);
  const lines = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const content = await fs.readFile(path.join(logs_path, entry), "utf8");
    lines.push(...content.split("\n").filter(Boolean));
  }
  return lines;
}

async function wait_for_title(session, expected_title) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if ((await session.get_info()).title === expected_title) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await session.get_info()).title, expected_title);
}

test("Session keeps title empty when no model is available", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-"),
  );
  const agent = new Agent({ id: "title_agent" });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") }));
  const session = await entry.sessions.create();
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

test("Session title generation does not block user message append", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-async-"),
  );
  const delayed = create_delayed_title_model("异步标题");
  const agent = new Agent({
    id: "title_async_agent",
    model: delayed.model,
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") }));
  const session = await entry.sessions.create();

  try {
    await session.append_user_message({ text: "标题生成不应阻塞消息写入" });
    await delayed.started;
    assert.equal((await session.get_info()).title, undefined);
    delayed.release();
    await wait_for_title(session, "异步标题");
  } finally {
    await agent.dispose();
  }
});

test("Session logs title generation failure without blocking the session", async () => {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-session-title-log-"),
  );
  const agent = new Agent({
    id: "title_log_agent",
    model: create_failing_title_model(),
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") }));
  const session = await entry.sessions.create();
  await session.set({ model: create_failing_title_model() });

  try {
    await session.append_user_message({
      text: "Diagnose why session title generation is flaky",
    });

    assert.equal((await session.get_info()).title, undefined);

    let log_lines = [];
    const log_deadline = Date.now() + 1000;
    while (Date.now() < log_deadline) {
      await entry.get_logger().save_all_logs();
      log_lines = await read_log_lines(entry.data_path);
      if (log_lines.some((line) => line.includes("session_title.generate_failed"))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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
  const agent = new Agent({ id: "title_retry_agent" });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path, data_root_path: path.join(agent_path, "data") }));
  const session = await entry.sessions.create();
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

    await wait_for_title(session, "排查 session 标题");
  } finally {
    unsubscribe();
    await agent.dispose();
  }
});
