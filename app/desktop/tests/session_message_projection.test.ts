/** Session 消息稳定分段投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionMessage } from "@downcity/agent";
import { project_session_message_segments, session_message_segment_size } from "../src/renderer/features/chat/lib/session_message_projection.ts";

function create_user_message(sequence: number): Extract<SessionMessage, { type: "user" }> {
  return {
    message_id: `user-${String(sequence)}`,
    session_id: "session",
    sequence,
    revision: 1,
    visibility: "visible",
    created_at: sequence,
    updated_at: sequence,
    type: "user",
    parts: [{ part_id: `part-${String(sequence)}`, type: "text", text: String(sequence), state: "done" }],
  };
}

function create_agent_message(sequence: number, status: "streaming" | "completed" = "completed"): Extract<SessionMessage, { type: "agent" }> {
  return {
    message_id: `assistant-${String(sequence)}`,
    session_id: "session",
    sequence,
    revision: 1,
    visibility: "visible",
    created_at: sequence,
    updated_at: sequence,
    type: "agent",
    kind: "normal",
    status,
    parts: [],
  };
}

test("尾部消息变化只替换命中的稳定分段", () => {
  const messages = Array.from({ length: session_message_segment_size * 3 }, (_, index) => create_user_message(index + 1));
  const previous = project_session_message_segments(messages);
  const updated = [...messages];
  updated[updated.length - 1] = { ...updated[updated.length - 1], revision: 2 };
  const next = project_session_message_segments(updated, previous);
  assert.equal(next.segments[0], previous.segments[0]);
  assert.equal(next.segments[1], previous.segments[1]);
  assert.notEqual(next.segments[2], previous.segments[2]);
});

test("五千条消息的尾部流式更新复用全部历史分段", () => {
  const messages: SessionMessage[] = Array.from({ length: 4_999 }, (_, index) => create_user_message(index + 1));
  messages.push(create_agent_message(5_000, "streaming"));
  const previous = project_session_message_segments(messages);
  const updated = [...messages];
  updated[updated.length - 1] = { ...updated[updated.length - 1], revision: 2, updated_at: 5_001 };
  const next = project_session_message_segments(updated, previous);
  assert.equal(next.segments.length, Math.ceil(5_000 / session_message_segment_size));
  assert.equal(next.segments.slice(0, -1).every((segment, index) => segment === previous.segments[index]), true);
  assert.notEqual(next.segments.at(-1), previous.segments.at(-1));
});

test("历史前插不会改变既有 sequence 分段引用", () => {
  const recent = Array.from({ length: session_message_segment_size }, (_, index) => create_user_message(session_message_segment_size + index + 1));
  const previous = project_session_message_segments(recent);
  const history = Array.from({ length: session_message_segment_size }, (_, index) => create_user_message(index + 1));
  const next = project_session_message_segments([...history, ...recent], previous);
  assert.equal(next.segments[1], previous.segments[0]);
});

test("跨分段边界的 Agent Action Part 仍保持自身消息所有权", () => {
  const agent = create_agent_message(session_message_segment_size);
  agent.parts = [{ part_id: "action-1", sequence: 1, type: "action", action_id: "action-1", action_type: "test", state: "completed", title: "Action" }];
  const next_user = create_user_message(session_message_segment_size + 2);
  const projection = project_session_message_segments([agent, next_user]);
  assert.deepEqual(projection.segments.map((segment) => segment.segment_id), [0, 1]);
  assert.equal(projection.segments[0].rows[0].message, agent);
  assert.equal(projection.segments[1].rows[0].message, next_user);
});

test("投影同时汇总流式状态与可压缩消息状态", () => {
  const projection = project_session_message_segments([create_agent_message(1, "streaming")]);
  assert.equal(projection.has_streaming_message, true);
  assert.equal(projection.has_conversation_message, true);
  assert.equal(project_session_message_segments([]).has_conversation_message, false);
});

test("末尾语义基于后续可见消息而不是用户消息类型", () => {
  const user = create_user_message(1);
  const agent = create_agent_message(2);
  agent.parts = [{ part_id: "action-1", sequence: 1, type: "action", action_id: "action-1", action_type: "test", state: "completed", title: "Action" }];
  const projection = project_session_message_segments([user, agent]);
  assert.equal(projection.segments[0].rows[0].has_later_visible_message, true);
  assert.equal(projection.segments[0].rows[1].has_later_visible_message, false);
});
