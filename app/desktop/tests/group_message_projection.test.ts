/** Group 共享消息持久分段测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopGroupMessage } from "../src/common/types/DesktopApi.ts";
import {
  append_group_message_projection,
  append_group_messages_projection,
  create_empty_group_message_projection,
  create_group_message_projection,
  group_message_segment_size,
  mark_group_message_read,
} from "../src/renderer/features/chat/lib/group/group_message_projection.ts";

function create_message(index: number): DesktopGroupMessage {
  return {
    message_id: `message-${index}`,
    author_type: "agent",
    author_id: "agent-1",
    text: `消息 ${index}`,
    created_at: index,
  };
}

test("Group 完整快照按固定容量建立稳定分段", () => {
  const messages = Array.from({ length: group_message_segment_size * 2 + 1 }, (_, index) => create_message(index));
  const projection = create_group_message_projection(messages);

  assert.equal(projection.message_count, messages.length);
  assert.deepEqual(projection.segments.map((segment) => segment.messages.length), [32, 32, 1]);
  assert.deepEqual(projection.segments.map((segment) => segment.segment_id), [0, 1, 2]);
});

test("Group 追加消息只替换未满的尾部分段", () => {
  const projection = create_group_message_projection(Array.from({ length: 40 }, (_, index) => create_message(index)));
  const updated = append_group_message_projection(projection, create_message(40));

  assert.equal(updated.message_count, 41);
  assert.equal(updated.segments[0], projection.segments[0]);
  assert.notEqual(updated.segments[1], projection.segments[1]);
  assert.equal(updated.segments[1].messages.length, 9);
});

test("Group 尾部分段已满时新增分段并复用全部历史", () => {
  const projection = create_group_message_projection(Array.from({ length: 64 }, (_, index) => create_message(index)));
  const updated = append_group_message_projection(projection, create_message(64));

  assert.equal(updated.segments.length, 3);
  assert.equal(updated.segments[0], projection.segments[0]);
  assert.equal(updated.segments[1], projection.segments[1]);
  assert.deepEqual(updated.segments[2].messages.map((message) => message.message_id), ["message-64"]);
});

test("Group 帧内消息批次只复制一次尾部分段", () => {
  const projection = create_group_message_projection(Array.from({ length: 30 }, (_, index) => create_message(index)));
  const updated = append_group_messages_projection(projection, Array.from({ length: 5 }, (_, index) => create_message(index + 30)));

  assert.equal(updated.message_count, 35);
  assert.equal(updated.segments.length, 2);
  assert.equal(updated.segments[0].messages.length, 32);
  assert.equal(updated.segments[1].messages.length, 3);
});

test("Group snapshot 与实时批次交叠时按 message_id 去重", () => {
  const projection = create_group_message_projection([create_message(0), create_message(1)]);
  const updated = append_group_messages_projection(projection, [create_message(1), create_message(2), create_message(2)]);

  assert.equal(updated.message_count, 3);
  assert.deepEqual(updated.segments[0].messages.map((message) => message.message_id), ["message-0", "message-1", "message-2"]);
  assert.equal(append_group_messages_projection(updated, [create_message(2)]), updated);
});

test("Group 已读事件只替换命中的消息分段", () => {
  const projection = create_group_message_projection(Array.from({ length: 64 }, (_, index) => create_message(index)));
  const updated = mark_group_message_read(projection, "message-40");

  assert.equal(updated.segments[0], projection.segments[0]);
  assert.notEqual(updated.segments[1], projection.segments[1]);
  assert.equal(updated.segments[1].read_message_ids.has("message-40"), true);
  assert.equal(mark_group_message_read(updated, "message-40"), updated);
});

test("Group 已读事件早于消息时在追加阶段收口", () => {
  const pending = mark_group_message_read(create_empty_group_message_projection(), "message-0");
  const updated = append_group_message_projection(pending, create_message(0));

  assert.equal(pending.pending_read_message_ids.has("message-0"), true);
  assert.equal(updated.pending_read_message_ids.size, 0);
  assert.equal(updated.segments[0].read_message_ids.has("message-0"), true);
});
