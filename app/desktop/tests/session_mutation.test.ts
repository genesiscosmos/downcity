/** Session mutation Renderer 投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAssistantMessage, SessionMutation, SessionUserMessage } from "@downcity/agent";
import {
  apply_indexed_session_mutations,
  apply_session_mutation,
  apply_session_mutations,
  create_session_message_index,
  merge_session_snapshot,
} from "../src/renderer/lib/chat/session_mutation.ts";

const assistant_message: SessionAssistantMessage = {
  message_id: "assistant-1",
  session_id: "session-1",
  turn_id: "turn-1",
  sequence: 2,
  revision: 1,
  visibility: "visible",
  created_at: 1,
  updated_at: 1,
  type: "assistant",
  kind: "normal",
  status: "streaming",
  parts: [{ part_id: "text-1", sequence: 1, type: "text", text: "你", state: "streaming" }],
};

const user_message: SessionUserMessage = {
  message_id: "user-1",
  session_id: "session-1",
  turn_id: "turn-1",
  sequence: 1,
  revision: 1,
  visibility: "visible",
  created_at: 1,
  updated_at: 1,
  type: "user",
  input_type: "prompt",
  parts: [{ part_id: "user-text-1", type: "text", text: "问题", state: "done" }],
};

test("按 delta 更新 assistant part 并拒绝旧 revision", () => {
  const delta: SessionMutation = {
    mutation_id: "mutation-1",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "assistant-1",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-1",
    delta: "好",
  };
  const updated = apply_session_mutation([assistant_message], delta);
  assert.equal(updated[0].revision, 2);
  assert.equal(updated[0].type === "assistant" && updated[0].parts[0].type === "text" ? updated[0].parts[0].text : "", "你好");
  assert.equal(apply_session_mutation(updated, { ...delta, mutation_id: "mutation-old", revision: 1, delta: "旧" }), updated);
});

test("较旧 snapshot 不覆盖已经收到的实时消息", () => {
  const live_message = { ...assistant_message, revision: 3 };
  const merged = merge_session_snapshot([live_message], [user_message, assistant_message]);
  assert.deepEqual(merged.map((message) => message.message_id), ["user-1", "assistant-1"]);
  assert.equal(merged[1].revision, 3);
});

test("相同 revision 的 snapshot 复用当前消息与数组引用", () => {
  const current = [user_message, assistant_message];
  const snapshot = [
    { ...user_message, parts: user_message.parts.map((part) => ({ ...part })) },
    { ...assistant_message, parts: assistant_message.parts.map((part) => ({ ...part })) },
  ];
  const merged = merge_session_snapshot(current, snapshot);

  assert.equal(merged, current);
  assert.equal(merged[0], user_message);
  assert.equal(merged[1], assistant_message);
});

test("较新 snapshot 只替换 revision 变化的消息", () => {
  const current = [user_message, assistant_message];
  const newer_assistant = { ...assistant_message, revision: 2 };
  const merged = merge_session_snapshot(current, [{ ...user_message }, newer_assistant]);

  assert.notEqual(merged, current);
  assert.equal(merged[0], user_message);
  assert.equal(merged[1], newer_assistant);
});

test("用户消息与 assistant delta 通过同一 mutation 流连续投影", () => {
  const with_user = apply_session_mutation([assistant_message], {
    mutation_id: "mutation-user",
    session_id: "session-1",
    created_at: 1,
    variant: "message",
    type: "snapshot",
    message_id: "user-1",
    turn_id: "turn-1",
    revision: 1,
    message: user_message,
  });
  const updated = apply_session_mutation(with_user, {
    mutation_id: "mutation-stream",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "assistant-1",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-1",
    delta: "好",
  });
  assert.deepEqual(updated.map((message) => message.message_id), ["user-1", "assistant-1"]);
  assert.equal(updated[1].type === "assistant" && updated[1].parts[0].type === "text" ? updated[1].parts[0].text : "", "你好");
  assert.equal(updated[1].type === "assistant" ? updated[1].status : "", "streaming");
});

test("同一帧的多个 delta 只生成一次最终消息投影", () => {
  const mutations: SessionMutation[] = [
    {
      mutation_id: "mutation-batch-1",
      session_id: "session-1",
      created_at: 2,
      variant: "delta",
      type: "text",
      message_id: "assistant-1",
      turn_id: "turn-1",
      revision: 2,
      part_id: "text-1",
      delta: "好",
    },
    {
      mutation_id: "mutation-batch-2",
      session_id: "session-1",
      created_at: 3,
      variant: "delta",
      type: "text",
      message_id: "assistant-1",
      turn_id: "turn-1",
      revision: 3,
      part_id: "text-1",
      delta: "！",
    },
  ];
  const updated = apply_session_mutations([user_message, assistant_message], mutations);
  assert.equal(updated[0], user_message);
  assert.equal(updated[1].revision, 3);
  assert.equal(updated[1].type === "assistant" && updated[1].parts[0].type === "text" ? updated[1].parts[0].text : "", "你好！");
});

test("批量投影在全部 mutation 无效时保留消息数组引用", () => {
  const messages = [assistant_message];
  const unchanged = apply_session_mutations(messages, [{
    mutation_id: "mutation-invalid",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "missing-message",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-1",
    delta: "无效",
  }]);
  assert.equal(unchanged, messages);
});

test("五千条消息的尾部 delta 复用持久位置索引", () => {
  const messages = Array.from({ length: 5_000 }, (_, index): SessionAssistantMessage => ({
    ...assistant_message,
    message_id: `assistant-${index}`,
    sequence: index + 1,
    parts: [{ ...assistant_message.parts[0], part_id: `text-${index}` }],
  }));
  const message_index = create_session_message_index(messages);
  const result = apply_indexed_session_mutations(messages, message_index, [{
    mutation_id: "mutation-tail",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "assistant-4999",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-4999",
    delta: "尾部",
  }]);

  assert.equal(result.message_index.positions_by_id, message_index.positions_by_id);
  assert.equal(result.messages[0], messages[0]);
  assert.notEqual(result.messages[4_999], messages[4_999]);
});

test("乱序到达的新消息按 sequence 插入并重建位置索引", () => {
  const messages = [user_message, { ...assistant_message, sequence: 3 }];
  const inserted_message: SessionUserMessage = {
    ...user_message,
    message_id: "user-2",
    sequence: 2,
  };
  const result = apply_indexed_session_mutations(messages, create_session_message_index(messages), [{
    mutation_id: "mutation-insert",
    session_id: "session-1",
    created_at: 2,
    variant: "message",
    type: "snapshot",
    message_id: inserted_message.message_id,
    turn_id: inserted_message.turn_id,
    revision: inserted_message.revision,
    message: inserted_message,
  }]);

  assert.deepEqual(result.messages.map((message) => message.message_id), ["user-1", "user-2", "assistant-1"]);
  assert.equal(result.message_index.positions_by_id.get("assistant-1"), 2);
});

test("无效 indexed mutation 同时保留消息与索引引用", () => {
  const messages = [assistant_message];
  const message_index = create_session_message_index(messages);
  const result = apply_indexed_session_mutations(messages, message_index, [{
    mutation_id: "mutation-invalid-indexed",
    session_id: "session-1",
    created_at: 2,
    variant: "delta",
    type: "text",
    message_id: "missing-message",
    turn_id: "turn-1",
    revision: 2,
    part_id: "text-1",
    delta: "无效",
  }]);

  assert.equal(result.messages, messages);
  assert.equal(result.message_index, message_index);
});
