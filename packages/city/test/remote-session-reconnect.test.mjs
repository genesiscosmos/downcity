/**
 * @file 验证 RemoteSession 在事件连接断开后能够重新建立订阅。
 *
 * 关键点（中文）
 * - 断流拒绝客户端等待，不能伪造服务端 Turn 终态，也不能永久挂起。
 * - 下一次 prompt 必须重新调用 transport.subscribe。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RemoteSession } from "../bin/remote/RemoteSession.js";

test("RemoteSession forwards set observability options to its transport", async () => {
  const calls = [];
  const transport = {
    async set(session_id, type, input, options) {
      calls.push({ session_id, type, input, options });
    },
  };
  const session = new RemoteSession(transport, {
    id: "session_test",
    type: "work", kind: "task",
    message_count: 0,
  });

  await session.set(
    { security: { approval_mode: "ask" } },
    { persist_action: false, publish_mutation: false },
  );

  assert.deepEqual(calls, [{
    session_id: "session_test",
    type: "work",
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
    id: "session_test",
    type: "work", kind: "task",
    message_count: 0,
  });

  const first_turn = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "first" });
  subscriptions[0].on_close(new Error("stream dropped"));
  await assert.rejects(first_turn.finished, (error) => error.code === "transport_lost" && error.turn_id === "turn_1" && error.message === "stream dropped");
  assert.equal(first_turn.result, null, "transport loss is not a server Turn result");

  const second_turn = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "second" });
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
