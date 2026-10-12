/** Group 单一循环的输入竞争回归：过期判断失效、整轮收齐、补充消息持久化。 */

import assert from "node:assert/strict";
import test from "node:test";
import { Agent, Group, Session } from "@downcity/agent";
import { City } from "../bin/index.js";

/** 手动控制异步边界，避免使用时间延迟猜测执行顺序。 */
function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

/** 等待一个指定的共享消息或阶段事件。 */
function wait_event(session, predicate) {
  return new Promise((resolve) => {
    const unsubscribe = session.subscribe((event) => {
      if (!predicate(event)) return;
      unsubscribe();
      resolve(event);
    });
  });
}

/** 统一注册测试群聊与成员。 */
async function create_group_session(strategy, members) {
  const city = new City();
  for (const member of members) city.agents.add(member);
  const group = new Group({ id: "input-group", members, dispatch_strategy: strategy });
  city.groups.add(group);
  const session = await group.sessions.create();
  return { city, group, session };
}

test("New input aborts the old decision and prevents its selected members from executing", { timeout: 3000 }, async (context) => {
  const started = deferred();
  const stale_result = deferred();
  const executions = [];
  const batches = [];
  let old_signal;
  class ReplySession extends Session {
    async prompt(input) {
      executions.push({ agent_id: this.agent_id, query: input.query });
      return { id: "reply", result: null, finished: Promise.resolve({ success: true, text: "updated result" }) };
    }
  }
  const strategy = {
    async decide_dispatch(input) {
      batches.push(input.pending_messages.map((message) => message.text));
      if (batches.length === 1) {
        old_signal = input.abort_signal;
        started.resolve();
        // 模拟返回较晚且不主动响应取消的客户端，过期结果仍不得启动成员。
        await stale_result.promise;
        return { member_ids: ["old"] };
      }
      return { member_ids: batches.length === 2 ? ["updated"] : [] };
    },
  };
  const { city, group, session } = await create_group_session(strategy, [
    new Agent({ id: "old", session_class: ReplySession }),
    new Agent({ id: "updated", session_class: ReplySession }),
  ]);
  context.after(async () => { stale_result.resolve(); await city.close(); });
  await session.prompt({ query: "implement the plan" });
  await started.promise;
  await session.prompt({ query: "only discuss the plan" });
  assert.equal(old_signal.aborted, true);
  assert.deepEqual(executions, []);
  const idle = wait_event(session, (event) => event.type === "status" && event.phase === "idle");
  stale_result.resolve();
  await idle;
  assert.deepEqual(batches[1], ["implement the plan", "only discuss the plan"]);
  assert.deepEqual(executions.map((entry) => entry.agent_id), ["updated"]);
  assert.match(executions[0].query, /only discuss the plan/);
  const store = group.get_session_store().session(session.id);
  assert.equal((await store.list_dispatch_turns())[0].status, "superseded");
  assert.deepEqual((await store.read_metadata()).pending_message_ids, []);
  assert.equal((await session.messages()).some((message) => message.sender_type === "system"), false);
});

test("Input during member execution waits for every member and joins the next decision batch", { timeout: 3000 }, async (context) => {
  const all_started = deferred();
  const gates = { fast: deferred(), slow: deferred() };
  const queries = [];
  const batches = [];
  class BlockingSession extends Session {
    async prompt(input) {
      queries.push(input.query);
      if (queries.length === 2) all_started.resolve();
      return { id: this.agent_id, result: null, finished: gates[this.agent_id].promise };
    }
  }
  const strategy = {
    decide_dispatch(input) {
      batches.push(input.pending_messages.map((message) => message.text));
      return { member_ids: batches.length === 1 ? ["fast", "slow"] : [] };
    },
  };
  const { city, group, session } = await create_group_session(strategy, [
    new Agent({ id: "fast", session_class: BlockingSession }),
    new Agent({ id: "slow", session_class: BlockingSession }),
  ]);
  context.after(async () => {
    gates.fast.resolve({ success: true, text: "fast reply" });
    gates.slow.resolve({ success: true, text: "slow reply" });
    await city.close();
  });
  await session.prompt({ query: "initial request" });
  await all_started.promise;
  await session.prompt({ query: "additional constraint" });
  await session.prompt({ query: "another constraint" });
  assert.equal(batches.length, 1);
  assert.equal(queries.length, 2);
  assert.equal(queries.some((query) => query.includes("additional constraint")), false);
  const store = group.get_session_store().session(session.id);
  assert.equal((await store.read_metadata()).pending_message_ids.length, 3);

  const fast_reply = wait_event(session, (event) => event.type === "message" && event.message.text === "fast reply");
  gates.fast.resolve({ success: true, text: "fast reply" });
  await fast_reply;
  assert.equal(batches.length, 1);
  const idle = wait_event(session, (event) => event.type === "status" && event.phase === "idle");
  gates.slow.resolve({ success: true, text: "slow reply" });
  await idle;
  assert.deepEqual(batches, [["initial request"], [
    "additional constraint", "another constraint", "fast reply", "slow reply",
  ]]);
  assert.deepEqual((await store.read_metadata()).pending_message_ids, []);
});
