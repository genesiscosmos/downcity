/**
 * @file 验证 Interaction 嵌套在所属 Tool Part 内，而不是作为独立 Part 平级存在。
 *
 * Interaction 与 Tool 是归属关系：Tool 在等待响应时阻塞，因此一次 Interaction 的
 * 完整生命周期落在所属 Tool 的执行区间内，归属即结构，需求顺序由数组顺序表达。
 * 同时验证 Agent 集合在没有 UI 订阅 Session 时观察交互，并复用原 Session 响应及私密入口。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionAgentMessageState } from "../bin/session/messages/SessionAgentMessageState.js";
import { SessionMessageCache } from "../bin/session/messages/SessionMessageCache.js";
import { SessionMessages } from "../bin/session/messages/SessionMessages.js";
import { Agent } from "../bin/agent/Agent.js";
import { AgentInteractions } from "../bin/agent/AgentInteractions.js";
import { AskQuestionsTool } from "../bin/tools/ask/AskQuestionsTool.js";
import { MockModelClient } from "./ModelClientMock.mjs";

/** 构造一条含 ready 状态 Tool Part 的流式 Assistant Message fixture。 */
function create_writer_fixture() {
  let message = {
    message_id: "agent:session-1:1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "agent",
    state: "streaming",
    parts: [
      {
        part_id: "tool:call-9",
        sequence: 1,
        step_id: "step-1",
        type: "tool",
        tool_call_id: "call-9",
        tool_name: "ask_question",
        state: "ready",
      },
    ],
  };
  // 缓存与 State 都是真实实例：Interaction 变更依赖“读取当前快照 → 替换 Tool”的
  // 串行语义，用桩会绕过被验证的部分。
  const cache = new SessionMessageCache({
    session_id: "session-1",
    publish: () => {},
  });
  cache.set_held(message.message_id);
  cache.accept(message, false);
  const store = {
    read_message: async (message_id) =>
      message_id === message.message_id ? structuredClone(message) : null,
    update_message: async (input) => {
      message = structuredClone(input.message);
      cache.accept(message, false);
    },
  };
  const state = new SessionAgentMessageState({
    session_id: "session-1",
    store,
    cache,
  });
  return {
    state,
    read_parts: () => message.parts,
    read_tool: () => message.parts.find((part) => part.type === "tool"),
  };
}

/** 构造一次属于 call-9 的提问请求。 */
function create_question_request(interaction_id = "interaction-1") {
  return {
    interaction_id,
    turn_id: "turn-1",
    type: "question",
    source: { type: "tool", tool_call_id: "call-9", tool_name: "ask_question" },
    payload: { questions: [] },
    created_at: 1,
  };
}

test("Interaction 创建后嵌套在所属 Tool Part 内，不再平级存在", async () => {
  const fixture = create_writer_fixture();

  const interaction = await fixture.state.request_interaction(create_question_request());

  assert.equal(interaction.status, "pending");
  // 关键断言：Message 只有一个 Part，Interaction 不是其中之一。
  assert.deepEqual(fixture.read_parts().map((part) => part.type), ["tool"]);
  const tool = fixture.read_tool();
  assert.equal(tool.state, "waiting-user");
  assert.deepEqual(
    tool.interactions.map((item) => item.interaction_id),
    ["interaction-1"],
  );
});

test("用户响应后 Tool 恢复运行，Interaction 就地终结", async () => {
  const fixture = create_writer_fixture();
  await fixture.state.request_interaction(create_question_request());

  await fixture.state.resolve_interaction("interaction-1", {
    type: "question",
    outcome: "resolved",
    payload: { answers: [{ question_id: "q1", value: "main" }] },
  });

  assert.deepEqual(fixture.read_parts().map((part) => part.type), ["tool"]);
  const tool = fixture.read_tool();
  assert.equal(tool.state, "running");
  assert.equal(tool.interactions[0].status, "resolved");
  assert.deepEqual(fixture.state.list_pending_interactions(), []);
});

test("拒绝响应会把所属 Tool 标记为失败", async () => {
  const fixture = create_writer_fixture();
  await fixture.state.request_interaction(create_question_request());

  await fixture.state.resolve_interaction("interaction-1", {
    type: "question",
    outcome: "denied",
    payload: {},
  });

  const tool = fixture.read_tool();
  assert.equal(tool.state, "failed");
  assert.equal(tool.interactions[0].status, "denied");
  assert.equal(tool.error, "Interaction denied");
});

test("取消未响应交互会把所属 Tool 标记为失败并保留原因", async () => {
  const fixture = create_writer_fixture();
  await fixture.state.request_interaction(create_question_request());

  await fixture.state.close_interaction("interaction-1", {
    reason: "turn_stopped",
  });

  const tool = fixture.read_tool();
  assert.equal(tool.state, "failed");
  assert.equal(tool.error, "Interaction cancelled");
  assert.equal(tool.interactions[0].status, "cancelled");
  assert.equal(tool.interactions[0].cancel_reason, "turn_stopped");
});

test("等待中的 Interaction 可以按 Tool 归属查询", async () => {
  const fixture = create_writer_fixture();
  await fixture.state.request_interaction(create_question_request("interaction-1"));
  await fixture.state.request_interaction(create_question_request("interaction-2"));

  assert.deepEqual(
    fixture.state.list_pending_interactions().map((item) => item.interaction_id),
    ["interaction-1", "interaction-2"],
  );
  // 同一 Tool 内部按发生顺序保留。
  assert.deepEqual(
    fixture.read_tool().interactions.map((item) => item.interaction_id),
    ["interaction-1", "interaction-2"],
  );
});

test("Message 收口仍然整条发布，消费方才能收敛 state", async () => {
  const stored_messages = [];
  const publications = [];
  const store = {
    initialize: async () => {},
    list_messages: async () => structuredClone(stored_messages),
    list_recoverable_agent_messages: async () => [],
    read_message: async (message_id) => structuredClone(
      stored_messages.find((message) => message.message_id === message_id) ?? null,
    ),
    message_stats: async () => ({ message_count: 0, storage_bytes: 0, latest_message: null }),
    create_message: async (build_message) => {
      const message = build_message({ message_sequence: 1 });
      stored_messages.push(structuredClone(message));
      return structuredClone(message);
    },
    update_message: async ({ message, expected_revision }) => {
      const index = stored_messages.findIndex(
        (candidate) => candidate.message_id === message.message_id,
      );
      if (stored_messages[index]?.revision !== expected_revision) {
        throw new Error("revision conflict");
      }
      stored_messages[index] = structuredClone(message);
    },
  };
  const messages = new SessionMessages({
    session_id: "session-1",
    store,
    publish: (mutation) => publications.push(mutation),
  });
  await messages.initialize();
  const writer = await messages.open_agent_message({ turn_id: "turn-1" });
  await writer.append_result_parts([{ type: "text", text: "处理中" }]);

  publications.length = 0;
  await writer.complete();

  assert.deepEqual(
    publications.map((mutation) => mutation.variant),
    ["message"],
  );
  assert.equal(publications[0].message.state, "done");
});

/** 提供真实 ask_user Tool Call，回答后结束原 Turn，不调用外部模型。 */
function create_interaction_model() {
  return new MockModelClient({
    id: "agent-interaction-collection",
    generate: async (call) => {
      if (call.prompt.some((message) => message.content.some((part) => part.type === "tool-result"))) {
        return { text: "answered" };
      }
      const is_private = call.prompt.some((message) => message.content.some((part) =>
        part.type === "text" && part.text.includes("private-input")));
      return {
        content: [{
          type: "tool_call", tool_call_id: `call-${crypto.randomUUID()}`, tool_name: "ask_user",
          input: { title: "input", questions: [{ question: "input", type: is_private ? "secret" : "text",
            ...(is_private ? { name: "fixture_secret" } : {}) }] },
        }],
        finishReason: "tool-calls",
      };
    },
  });
}

test("Agent 集合无需 UI 即可观察 Chat/Work/task，并经原 Session 响应与私密提交", { timeout: 10000 }, async (t) => {
  const agent = new Agent({ id: "interaction-owner", model: create_interaction_model(), tools: { ask_user: AskQuestionsTool } });
  t.after(async () => { await agent.dispose(); });
  const events = [];
  const waiters = new Map();
  const unsubscribe = agent.interactions.subscribe((change) => {
    events.push(change);
    if (change.type === "updated" && change.item.interaction.status === "pending") {
      waiters.get(change.item.reference.session_id)?.(change.item);
    }
  });
  t.after(unsubscribe);
  // 不打开 UI，不对单个 Session 调用 subscribe；只订阅 Agent 主体。
  const origins = [{ category: "chat", type: "channel" }, { category: "work", type: "work" }, { category: "work", type: "task" }];
  for (const origin of origins) {
    const session = await agent.sessions.create({ origin });
    const pending = new Promise((resolve) => { waiters.set(session.id, resolve); });
    const turn = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: origin.type === "task" ? "private-input" : "public-input" });
    const item = await pending;
    assert.deepEqual(item.reference, { session_category: origin.category, session_id: session.id,
      turn_id: turn.id, interaction_id: item.interaction.interaction_id });
    assert.equal(item.can_respond, true);
    assert.deepEqual((await agent.interactions.list()).map((entry) => entry.reference), [item.reference]);
    assert.equal((await agent.interactions.list())[0].can_respond, true);
    const response = { type: "question", outcome: "resolved", payload: { answers: [{
      question_id: item.interaction.request.payload.questions[0].question_id,
      value: origin.type === "task" ? "private-answer-fixture" : "public-answer",
    }] } };
    await assert.rejects(agent.interactions.respond({ reference: { ...item.reference, turn_id: "wrong-turn" }, response }), /turn reference mismatch/);
    if (origin.type === "task") {
      await assert.rejects(agent.interactions.respond({ reference: item.reference, response }), /private submission endpoint/);
      const receipt = await agent.interactions.submit_private({ reference: item.reference, response });
      assert.equal(receipt.response.payload.answers[0].value, "$" + "{secrets.fixture_secret}");
      assert.deepEqual(await agent.interactions.submit_private({ reference: item.reference, response }), receipt);
      await assert.rejects(agent.interactions.submit_private({ reference: { ...item.reference, turn_id: "wrong-turn" }, response }), /turn reference mismatch/);
    } else {
      const results = await Promise.allSettled([
        agent.interactions.respond({ reference: item.reference, response }),
        agent.interactions.respond({ reference: item.reference, response }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    }
    assert.equal((await turn.finished).success, true);
    assert.deepEqual(await agent.interactions.list(), []);
    assert.ok(events.some((event) => event.type === "updated" && event.item.reference.interaction_id === item.reference.interaction_id
      && event.item.interaction.status === "resolved" && !event.item.can_respond));
    assert.equal(JSON.stringify(await session.messages({ include_internal: true })).includes("private-answer-fixture"), false);
  }
  assert.equal(JSON.stringify(events).includes("private-answer-fixture"), false);
});

test("历史 pending 没有原运行 waiter 时 can_respond 为 false，读取及回应均不恢复执行器", async () => {
  const interaction = { interaction_id: "cold", interaction_type: "question", status: "pending", request: create_question_request("cold") };
  const item = { reference: { session_category: "work", session_id: "cold-session", turn_id: "turn-1", interaction_id: "cold" },
    interaction, can_respond: true };
  const collection = new AgentInteractions({
    sessions: { on_removed: () => () => {}, list_cached_sessions: () => [],
      get: () => { throw new Error("read must not restore Session"); } },
    get_store: () => ({ list_pending_interactions: async () => [structuredClone(item)] }),
    logger: { error: () => {} },
  });
  try {
    assert.equal((await collection.list())[0].can_respond, false);
    await assert.rejects(collection.respond({ reference: item.reference,
      response: { type: "question", outcome: "resolved", payload: {} } }), /original Session is not running/);
    assert.equal(item.interaction.status, "pending");
  } finally { collection.dispose(); }
});
