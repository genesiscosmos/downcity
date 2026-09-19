/**
 * @file 验证 SessionMessages 将 Error 归入当前 Turn 的 Agent Message，而非无条件新建消息。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionMessages } from "../bin/session/messages/SessionMessages.js";

/** 创建支持聚合创建和 expected revision 更新的最小内存 SessionStorage。 */
function create_fixture(initial_messages = []) {
  let stored_messages = structuredClone(initial_messages);
  let update_count = 0;
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
    message_stats: async () => ({ message_count: stored_messages.length, storage_bytes: 0, latest_message: structuredClone(stored_messages.at(-1) ?? null) }),
    create_message: async (build_message) => {
      const message = build_message({
        message_sequence: next_message_sequence(stored_messages),
      });
      stored_messages.push(structuredClone(message));
      return structuredClone(message);
    },
    update_message: async ({ message, expected_revision }) => {
      update_count += 1;
      const index = stored_messages.findIndex(
        (candidate) => candidate.message_id === message.message_id,
      );
      const current = stored_messages[index];
      if (!current || current.revision !== expected_revision) throw new Error("revision conflict");
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
    read_active: () => structuredClone(stored_messages.filter((message) => message.role !== "agent" || message.state !== "streaming")),
    read_draft: () => structuredClone(stored_messages.find((message) => message.role === "agent" && message.state === "streaming") ?? null),
    get_update_count: () => update_count,
  };
}

test("Model delta 只更新运行投影，Step 完成时才持久化一次", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();
  const writer = await fixture.messages.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({ type: "text_start", content_id: "text-1" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "你" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "好" });
  await writer.apply_model_event({ type: "text_finish", content_id: "text-1" });

  assert.equal(fixture.get_update_count(), 0);
  assert.equal(fixture.read_draft().parts.length, 0);
  assert.equal(fixture.messages.get_message(writer.message_id).parts[0].text, "你好");

  await writer.finish_step([{
    part_id: "collector-text-1",
    sequence: 1,
    type: "text",
    text: "你好",
    state: "done",
  }]);

  assert.equal(fixture.get_update_count(), 1);
  assert.equal(fixture.read_draft().parts[0].text, "你好");
});

/** 返回下一条顶层 Message sequence。 */
function next_message_sequence(messages) {
  return messages
    .reduce((maximum, message) => Math.max(maximum, message.sequence), 0) + 1;
}

/** 创建一条已完成的 canonical Agent Message。 */
function create_completed_agent_message() {
  return {
    message_id: "agent-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "agent",
    state: "done",
    parts: [{ part_id: "text-1", sequence: 1, type: "text", text: "处理中", state: "done" }],
  };
}

/** 创建标准 Turn Error 输入。 */
function create_error_input() {
  return {
    scope: "turn",
    turn_id: "turn-1",
    code: "turn_execution_failed",
    message: "执行失败",
    recoverable: true,
  };
}

test("已有流式 Agent Message 时 Error 追加到同一草稿", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();
  const writer = await fixture.messages.open_agent_message({ turn_id: "turn-1" });
  await writer.append_result_parts([{ type: "text", text: "处理中" }]);
  const message_id = writer.message_id;

  const result = await fixture.messages.append_error_part(create_error_input());

  assert.equal(result.message_id, message_id);
  assert.equal(fixture.read_active().length, 0);
  assert.deepEqual(fixture.read_draft().parts.map((part) => part.type), ["text", "error"]);
  assert.deepEqual(fixture.read_draft().parts.map((part) => part.sequence), [1, 2]);
});

test("已有已完成 Agent Message 时 Error 作为同 Message 的新 revision 追加", async () => {
  const original = create_completed_agent_message();
  const fixture = create_fixture([original]);
  await fixture.messages.initialize();

  const result = await fixture.messages.append_error_part(create_error_input());

  assert.equal(result.message_id, original.message_id);
  assert.equal(fixture.read_active().length, 1);
  assert.deepEqual(result.parts.map((part) => part.type), ["text", "error"]);
  assert.deepEqual(result.parts.map((part) => part.sequence), [1, 2]);
  assert.equal(result.revision, 2);
  assert.equal(result.state, "done");
});

test("同 Turn 同错误码重复追加保持幂等", async () => {
  const fixture = create_fixture([create_completed_agent_message()]);
  await fixture.messages.initialize();
  const first = await fixture.messages.append_error_part(create_error_input());
  const second = await fixture.messages.append_error_part(create_error_input());

  assert.equal(second.message_id, first.message_id);
  assert.equal(second.revision, first.revision);
  assert.equal(second.parts.filter((part) => part.type === "error").length, 1);
});

test("Turn 尚无 Agent Message 时才创建仅含 Error 的 Agent Message", async () => {
  const fixture = create_fixture();
  await fixture.messages.initialize();

  const result = await fixture.messages.append_error_part(create_error_input());

  assert.equal(result.role, "agent");
  assert.equal(result.state, "done");
  assert.deepEqual(result.parts.map((part) => part.type), ["error"]);
  assert.equal(fixture.read_active().length, 1);
});
