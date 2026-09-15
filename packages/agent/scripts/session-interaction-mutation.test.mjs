/**
 * @file 验证 Interaction 嵌套在所属 Tool Part 内，而不是作为独立 Part 平级存在。
 *
 * Interaction 与 Tool 是归属关系：Tool 在等待响应时阻塞，因此一次 Interaction 的
 * 完整生命周期落在所属 Tool 的执行区间内，归属即结构，需求顺序由数组顺序表达。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionMessageInteractionWriter } from "../bin/session/messages/SessionMessageInteractionWriter.js";
import { SessionMessages } from "../bin/session/SessionMessages.js";

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
  const writer = new SessionMessageInteractionWriter({
    list_messages: () => [message],
    find_tool_in_open_message: (tool_call_id) => {
      const part = message.parts.find(
        (item) => item.type === "tool" && item.tool_call_id === tool_call_id,
      );
      return part ? { message_id: message.message_id, part } : undefined;
    },
    enqueue_assistant_write: async (_message_id, operation) => await operation(),
    commit_assistant_snapshot: async (_current, parts) => {
      message = { ...message, revision: message.revision + 1, parts };
    },
  });
  return {
    writer,
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

  const interaction = await fixture.writer.request(create_question_request());

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
  await fixture.writer.request(create_question_request());

  await fixture.writer.resolve("interaction-1", {
    type: "question",
    outcome: "resolved",
    payload: { answers: [{ question_id: "q1", value: "main" }] },
  });

  assert.deepEqual(fixture.read_parts().map((part) => part.type), ["tool"]);
  const tool = fixture.read_tool();
  assert.equal(tool.state, "running");
  assert.equal(tool.interactions[0].status, "resolved");
  assert.deepEqual(fixture.writer.list_pending(), []);
});

test("拒绝响应会把所属 Tool 标记为失败", async () => {
  const fixture = create_writer_fixture();
  await fixture.writer.request(create_question_request());

  await fixture.writer.resolve("interaction-1", {
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
  await fixture.writer.request(create_question_request());

  await fixture.writer.close("interaction-1", {
    status: "cancelled",
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
  await fixture.writer.request(create_question_request("interaction-1"));
  await fixture.writer.request(create_question_request("interaction-2"));

  assert.deepEqual(
    fixture.writer.list_pending().map((item) => item.interaction_id),
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
