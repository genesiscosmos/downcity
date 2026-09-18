/**
 * @file 验证上下文压缩以 Action Part 记录结果，且空操作不产生 Action。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";
import { Agent, DefaultSessionComposer, Session } from "@downcity/agent";
import { Workspace } from "@downcity/city";

/** 构造 usage 达到上下文窗口 95% 的模型流，用于触发上下文推进。 */
function create_pressure_stream(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text_1" });
        controller.enqueue({ type: "text-delta", id: "text_1", delta: text });
        controller.enqueue({ type: "text-end", id: "text_1" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 95 }, outputTokens: { total: 5 } },
        });
        controller.close();
      },
    }),
  };
}

/** 记录调用次数、按脚本返回结果的 Composer。 */
class ScriptedComposer extends DefaultSessionComposer {
  constructor(outcome) {
    super();
    this.outcome = outcome;
    this.advance_calls = 0;
  }

  async advance_context() {
    this.advance_calls += 1;
    if (this.outcome === "throw") throw new Error("summary model unavailable");
    return this.outcome === "compact";
  }
}

/** 将 canonical Agent Message 内的 Action Part 投影为便于断言的记录。 */
function read_action_records(messages) {
  return messages.flatMap((message) => message.role === "agent"
    ? message.parts
        .filter((part) => part.type === "action")
        .map((part) => ({ ...message, ...part }))
    : []);
}

/** 用指定 Composer 结果运行一个达到压缩阈值的 Turn，并返回 Action 记录。 */
async function run_pressure_turn(outcome) {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-session-compaction-action-"),
  );
  const composer = new ScriptedComposer(outcome);
  const model = new MockModelClient({
    modelId: "compaction-action-model",
    doStream: async () => create_pressure_stream("done"),
  });
  model.context_window = 100;

  class ScriptedSession extends Session {
    constructor(options) {
      super({ ...options, composer });
    }
  }

  const agent = new Agent({
    id: "compaction_action_agent",
    model,
    session_class: ScriptedSession,
  });
  const workspace = new Workspace({
    id: "test_workspace",
    path: agent_path,
    data_root_path: path.join(agent_path, "data"),
  });

  try {
    const session = await agent.sessions.create({
      workspace,
      session_id: `compaction_action_${outcome}`,
    });
    const turn = await session.prompt({ query: "first" });
    const result = await turn.finished;
    return {
      result,
      recover_calls: composer.advance_calls,
      actions: read_action_records((await session.messages()).items)
        .filter((record) => record.action_type === "context-compaction"),
    };
  } finally {
    await agent.dispose();
    await workspace.dispose();
    await fs.rm(agent_path, { recursive: true, force: true });
  }
}

test("上下文压缩成功时记录 completed Action Part", async () => {
  const { result, recover_calls, actions } = await run_pressure_turn("compact");

  assert.equal(result.success, true, result.error);
  assert.equal(recover_calls, 1);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].state, "completed");
  assert.equal(actions[0].title, "Session context compacted");
  // Action 属于辅助活动记录：Turn 已收口时回退为独立 Agent Message。
  assert.equal(actions[0].role, "agent");
});

test("没有可压缩区间时不产生 Action", async () => {
  const { result, recover_calls, actions } = await run_pressure_turn("none");

  assert.equal(result.success, true, result.error);
  assert.equal(recover_calls, 1);
  assert.deepEqual(actions, []);
});

test("上下文压缩失败时记录 failed Action Part", async () => {
  const { result, recover_calls, actions } = await run_pressure_turn("throw");

  assert.equal(result.success, false);
  assert.equal(recover_calls, 1);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].state, "failed");
  assert.equal(actions[0].title, "Session context compaction failed");
  assert.equal(actions[0].description, "summary model unavailable");
});
