/**
 * @file 验证 RemoteSession 在事件连接断开后能够重新建立订阅。
 *
 * 关键点（中文）
 * - 断流必须结束当前 pending turn，避免 finished 永久等待。
 * - 下一次 prompt 必须重新调用 transport.subscribe。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RemoteSession } from "../bin/remote/RemoteSession.js";

test("RemoteSession forwards set observability options to its transport", async () => {
  const calls = [];
  const transport = {
    async set(session_id, input, options) {
      calls.push({ session_id, input, options });
    },
  };
  const session = new RemoteSession(transport, {
    agent_id: "agent_test",
    session_id: "session_test",
    message_count: 0,
  });

  await session.set(
    { security: { approval_mode: "ask" } },
    { persist_action: false, publish_mutation: false },
  );

  assert.deepEqual(calls, [{
    session_id: "session_test",
    input: { security: { approval_mode: "ask" } },
    options: { persist_action: false, publish_mutation: false },
  }]);
});

test("RemoteSession reconnects the event pump after transport close", async () => {
  const subscriptions = [];
  let prompt_count = 0;
  const transport = {
    async subscribe(input) {
      subscriptions.push(input);
      input.on_ready();
      return { close: async () => {} };
    },
    async prompt() {
      prompt_count += 1;
      return { id: `turn_${prompt_count}` };
    },
    async get_info() {
      throw new Error("unused");
    },
    async stop() {
      return { stopped: false, cancelled_queued_prompts: 0, reason: "idle" };
    },
    async records() {
      throw new Error("unused");
    },
    async system() {
      throw new Error("unused");
    },
    async fork() {
      throw new Error("unused");
    },
  };
  const session = new RemoteSession(transport, {
    agent_id: "agent_test",
    session_id: "session_test",
    message_count: 0,
  });

  const first_turn = await session.prompt({ query: "first" });
  subscriptions[0].on_close(new Error("stream dropped"));
  assert.deepEqual(await first_turn.finished, {
    turn_id: "turn_1",
    text: "",
    success: false,
    error: "stream dropped",
  });

  const second_turn = await session.prompt({ query: "second" });
  assert.equal(subscriptions.length, 2);
  subscriptions[1].on_event({
    mutation_id: "turn-finish-2",
    variant: "turn",
    type: "finish",
    session_id: "session_test",
    turn_id: second_turn.id,
    status: "completed",
    created_at: Date.now(),
    text: "done",
  });
  assert.equal((await second_turn.finished).text, "done");
});

test("RemoteSession queues compact through its transport", async () => {
  const compacted_session_ids = [];
  let subscription;
  const transport = {
    async subscribe(input) {
      subscription = input;
      input.on_ready();
      return { close: async () => {} };
    },
    async compact(session_id) {
      compacted_session_ids.push(session_id);
      return { id: "compact_test" };
    },
  };
  const session = new RemoteSession(transport, {
    agent_id: "agent_test",
    session_id: "session_test",
    message_count: 0,
  });

  const handle = await session.compact();

  assert.deepEqual(compacted_session_ids, ["session_test"]);
  assert.equal(handle.id, "compact_test");
  assert.equal(handle.result, null);

  subscription.on_event({
    mutation_id: "compact-finish",
    variant: "compact",
    type: "finish",
    session_id: "session_test",
    compact_id: handle.id,
    status: "completed",
    compacted: false,
    reason: "nothing_to_compact",
    created_at: Date.now(),
  });

  assert.deepEqual(await handle.finished, {
    compact_id: "compact_test",
    success: true,
    compacted: false,
    reason: "nothing_to_compact",
  });
  assert.deepEqual(handle.result, await handle.finished);
});

test("RemoteSession preserves an early compact finish until transport returns", async () => {
  let subscription;
  const transport = {
    async subscribe(input) {
      subscription = input;
      input.on_ready();
      return { close: async () => {} };
    },
    async compact() {
      subscription.on_event({
        mutation_id: "compact-early-finish",
        variant: "compact",
        type: "finish",
        session_id: "session_test",
        compact_id: "compact_early",
        status: "completed",
        compacted: true,
        reason: "compacted",
        created_at: Date.now(),
      });
      return { id: "compact_early" };
    },
  };
  const session = new RemoteSession(transport, {
    agent_id: "agent_test",
    session_id: "session_test",
    message_count: 0,
  });

  const handle = await session.compact();

  assert.deepEqual(handle.result, {
    compact_id: "compact_early",
    success: true,
    compacted: true,
    reason: "compacted",
  });
  assert.deepEqual(await handle.finished, handle.result);
});
