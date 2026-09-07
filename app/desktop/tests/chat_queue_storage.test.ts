/** Desktop Chat 待发送队列持久化记录校验测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  chat_composer_schema_version,
  create_recovered_queue_pause_state,
  parse_persisted_chat_queue,
  project_persisted_chat_queues,
} from "../src/renderer/features/chat/composer/storage/chatComposerStorage.ts";

/** 创建一条持久化队列消息。 */
function create_message(message_id: string, text: string, sending = false, paused = false) {
  return {
    message_id,
    input: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    created_at: 1,
    sending,
    paused,
  };
}

/** 创建一条持久化队列记录。 */
function create_record(queued_messages: ReturnType<typeof create_message>[]) {
  return {
    schema_version: chat_composer_schema_version,
    session_key: "session|1:w|1:a|1:s",
    queued_messages,
    updated_at: 2,
  };
}

test("恢复队列顺序、完整输入和单项暂停状态", () => {
  const first = create_message("first", "第一条", false, true);
  const second = create_message("second", "第二条");

  assert.deepEqual(project_persisted_chat_queues([create_record([first, second])]), {
    "session|1:w|1:a|1:s": [first, second],
  });
});

test("恢复时重置发送中状态，避免崩溃状态锁死队列", () => {
  const record = create_record([create_message("sending", "待确认", true)]);

  assert.equal(parse_persisted_chat_queue(record)?.queued_messages[0]?.sending, false);
});

test("恢复出的每个队列默认进入会话级暂停状态", () => {
  const queues = project_persisted_chat_queues([
    create_record([create_message("first", "第一条")]),
    { ...create_record([create_message("second", "第二条")]), session_key: "session|1:w|1:a|2:s2" },
  ]);

  assert.deepEqual(create_recovered_queue_pause_state(queues), {
    "session|1:w|1:a|1:s": true,
    "session|1:w|1:a|2:s2": true,
  });
});

test("过滤损坏消息，并忽略空队列与非 Agent Session 队列", () => {
  const valid = create_message("valid", "可恢复");
  const damaged = { ...create_message("damaged", ""), input: { type: "doc" } };
  const mixed = { ...create_record([valid]), queued_messages: [damaged, valid] };
  const empty = create_record([]);
  const group = { ...create_record([valid]), session_key: "group|1:w|1:g|1:s" };

  assert.deepEqual(parse_persisted_chat_queue(mixed)?.queued_messages, [valid]);
  assert.equal(parse_persisted_chat_queue(empty), undefined);
  assert.equal(parse_persisted_chat_queue(group), undefined);
});
