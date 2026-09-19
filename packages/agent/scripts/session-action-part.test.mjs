/**
 * @file 验证 Session Action 在存在流式 Agent Message 时内联进同一条 Message，否则回退独立消息。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionMessages } from "../bin/session/messages/SessionMessages.js";

/** 创建支持聚合创建和 expected revision 更新的最小内存 SessionStorage。 */
function create_fixture(initial_messages = []) {
  const stored_messages = structuredClone(initial_messages);
  const publications = [];
  const store = {
    initialize: async () => {},
    list_messages: async () => structuredClone(stored_messages),
    list_recoverable_agent_messages: async () => structuredClone(
      stored_messages.filter((message) =>
        message.role === "agent" && message.state === "streaming"
      ),
    ),
    read_message: async (message_id) => structuredClone(
      stored_messages.find((message) => message.message_id === message_id) ?? null,
    ),
    read_latest_agent_message: async (turn_id) => structuredClone(
      stored_messages
        .filter((message) =>
          message.role === "agent" && (!turn_id || message.turn_id === turn_id)
        )
        .sort((left, right) => right.sequence - left.sequence)[0] ?? null,
    ),
    message_stats: async () => ({
      message_count: stored_messages.length,
      storage_bytes: 0,
      latest_message: structuredClone(stored_messages.at(-1) ?? null),
    }),
    create_message: async (build_message) => {
      const message = build_message({
        message_sequence: stored_messages.reduce(
          (maximum, candidate) => Math.max(maximum, candidate.sequence),
          0,
        ) + 1,
      });
      stored_messages.push(structuredClone(message));
      return structuredClone(message);
    },
    update_message: async ({ message, expected_revision }) => {
      const index = stored_messages.findIndex(
        (candidate) => candidate.message_id === message.message_id,
      );
      const current = stored_messages[index];
      if (!current || current.revision !== expected_revision) {
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
  return {
    messages,
    publications,
    read_visible: () => structuredClone(stored_messages),
    read_draft: () => structuredClone(
      stored_messages.find(
        (message) => message.role === "agent" && message.state === "streaming",
      ) ?? null,
    ),
  };
}

/** 构造一条已完成 Turn 的配置变更 Action 事件。 */
function create_config_action(overrides = {}) {
  return {
    action_id: "config-1",
    action_type: "command",
    turn_id: "turn-1",
    title: "Session configuration updated",
    description: "model: demo-model",
    status: "completed",
    ...overrides,
  };
}

test("存在流式 Agent Message 时 Action 内联为同一条 Message 的 Part", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();
  const writer = await fixture.messages.open_agent_message({ turn_id: "turn-1" });
  await writer.append_result_parts([{ type: "text", text: "处理中" }]);
  const message_id = writer.message_id;

  await fixture.messages.persist_action(create_config_action());

  const visible = fixture.read_visible();
  assert.equal(visible.length, 1, "不应新增独立 Agent Message");
  assert.equal(visible[0].message_id, message_id);
  assert.deepEqual(visible[0].parts.map((part) => part.type), ["text", "action"]);
  assert.deepEqual(visible[0].parts.map((part) => part.sequence), [1, 2]);
  const action_part = visible[0].parts[1];
  assert.equal(action_part.action_id, "config-1");
  assert.equal(action_part.state, "completed");
  assert.equal(action_part.title, "Session configuration updated");
});

test("同一 Action ID 重复落盘原地更新，不产生重复 Part", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();
  const writer = await fixture.messages.open_agent_message({ turn_id: "turn-1" });
  await writer.append_result_parts([{ type: "text", text: "处理中" }]);

  await fixture.messages.persist_action(create_config_action({
    status: "running",
    description: undefined,
  }));
  await fixture.messages.persist_action(create_config_action({
    description: "security.approval_mode: ask",
  }));

  const draft = fixture.read_draft();
  assert.deepEqual(draft.parts.map((part) => part.type), ["text", "action"]);
  assert.equal(draft.parts[1].state, "completed");
  assert.equal(draft.parts[1].description, "security.approval_mode: ask");
});

test("没有流式目标时 Action 回退为独立 Agent Message", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();

  await fixture.messages.persist_action(create_config_action({
    action_id: "config-standalone",
    turn_id: undefined,
  }));

  const visible = fixture.read_visible();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].message_id, "config-standalone");
  assert.equal(visible[0].state, "done");
  assert.deepEqual(visible[0].parts.map((part) => part.type), ["action"]);
});

test("Turn 存在但尚未产生 Agent Message 时 Action 仍可观测", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();

  await fixture.messages.persist_action(create_config_action({ action_id: "config-early" }));

  const visible = fixture.read_visible();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].message_id, "config-early");
  assert.equal(visible[0].turn_id, "turn-1");
  assert.equal(visible[0].state, "done");
});

test("publish_mutation=false 时内联 Action 不发布 Message Mutation", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();
  const writer = await fixture.messages.open_agent_message({ turn_id: "turn-1" });
  await writer.append_result_parts([{ type: "text", text: "处理中" }]);
  const baseline = fixture.publications.length;

  await fixture.messages.persist_action(create_config_action(), {
    publish_mutation: false,
  });

  assert.equal(fixture.publications.length, baseline);
  assert.deepEqual(
    fixture.read_visible()[0].parts.map((part) => part.type),
    ["text", "action"],
  );
});
