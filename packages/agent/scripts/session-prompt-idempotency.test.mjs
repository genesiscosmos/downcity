/**
 * @file 验证 Session Prompt 按 canonical 输入定位权威 Turn 完成日志，不重复执行同一业务请求。
 */

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { SessionLoop } from "../bin/session/loop/SessionLoop.js";
import { SessionQueue } from "../bin/session/loop/SessionQueue.js";
import { SessionEventHub } from "../bin/session/messages/SessionEventHub.js";
const actor = { kind: "user", user_id: "local" };

/** 创建只覆盖已完成幂等请求读取路径的最小 SessionLoop。 */
function create_loop(request_id, unfinished = false) {
  const session_id = "idempotent-session";
  const digest = createHash("sha256")
    .update(session_id)
    .update("\u0000")
    .update(request_id)
    .digest("hex");
  const turn_id = `turn-request:${digest}`;
  const user_message = {
    message_id: `user-request:${digest}`,
    session_id,
    turn_id,
    sequence: 1,
    revision: 1,
    created_at: 1,
    updated_at: 1,
    role: "user",
    parts: [{ part_id: "user-part", sequence: 1, type: "text", text: "hello" }],
    meta: { from: actor },
  };
  const agent_message = {
    message_id: "agent-result",
    session_id,
    turn_id,
    sequence: 2,
    revision: 1,
    created_at: 2,
    updated_at: 2,
    stable_part_sequence: 0,
    role: "agent",
    state: "done",
    parts: [{ part_id: "agent-part", sequence: 1, type: "text", text: "world", state: "done" }],
  };
  let execute_count = 0;
  const read_completion = async (requested_session_id, requested_turn_id) => !unfinished
    && requested_session_id === session_id && requested_turn_id === turn_id
    ? { session_id, turn_id, status: "completed", result: { text: "world", success: true } }
    : undefined;
  const loop = new SessionLoop({
    session_id,
    completions: {
      read: read_completion,
      read_initial: read_completion,
    },
    session_origin: { category: "work", type: "work" },
    get_workspace_path: () => ("/tmp/downcity-idempotent-prompt"),
    executor: {
      execute: async () => {
        execute_count += 1;
        return { text: "unexpected", success: true };
      },
      is_executing: () => false,
    },
    advance_context: async () => false,
    maintain_context: async () => {},
    state: { ensure_runnable: async () => {} },
    messages: {
      list_history_messages: async () => [user_message, agent_message],
      list_pending_interactions: () => [],
      read_input: async () => null,
      read_message: async (message_id) => message_id === user_message.message_id
        ? user_message
        : null,
      read_latest_agent_message: async (requested_turn_id) => requested_turn_id === turn_id
        ? agent_message
        : null,
    },
    events: new SessionEventHub(),
    logger: { log: async () => {} },
    queue: new SessionQueue(),
    interactions: { cancel_all: async () => {} },
    shell_approval_gateway: {},
  });
  return { loop, turn_id, get_execute_count: () => execute_count };
}

test("相同 request_id 直接恢复原 Turn 结果且不重复执行", async () => {
  const request_id = "inbound_123";
  const { loop, turn_id, get_execute_count } = create_loop(request_id);

  const first = await loop.prompt({ actor, query: "hello", request_id });
  const second = await loop.prompt({ actor, query: "hello", request_id });

  assert.equal(first.id, turn_id);
  assert.equal(second.id, turn_id);
  assert.deepEqual(await first.finished, {
    turn_id,
    text: "world",
    success: true,
  });
  assert.deepEqual(await second.finished, await first.finished);
  assert.equal(get_execute_count(), 0);
  await assert.rejects(loop.prompt({ actor: { kind: "user", user_id: "other" }, query: "hello", request_id }), /different Session prompt actor/);
});

test("重启后没有 Turn 终态日志时恢复占用，单条消息 done 不能释放整个 Turn", async () => {
  const { loop, get_execute_count } = create_loop("unfinished", true);
  await loop.initialize_occupation();
  assert.deepEqual(loop.occupied_by(), actor);
  await assert.rejects(loop.prompt({ actor: { kind: "user", user_id: "other" }, query: "new work" }), (error) => error.code === "session_busy");
  assert.equal(get_execute_count(), 0);
});
