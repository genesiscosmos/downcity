/**
 * @file 验证 SessionMessages 不会掩盖 canonical Store 写入失败。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SessionMessages } from "../bin/session/SessionMessages.js";

function create_messages(store) {
  return new SessionMessages({
    session_id: "messages-error-session",
    store: {
      initialize: async () => {},
      list_messages: async () => [],
      ...store,
    },
    publish: () => {},
  });
}

test("append_user_message 透传 Store 写入失败", async () => {
  const messages = create_messages({
    create_message: async () => {
      throw new Error("disk full");
    },
  });
  await messages.initialize();
  await assert.rejects(
    messages.append_user_message({
      turn_id: "turn-1",
      input_type: "prompt",
      parts: [{
        part_id: "text-1",
        type: "text",
        text: "hello",
        state: "done",
      }],
    }),
    /disk full/,
  );
});

test("open_agent_message 透传草稿写入失败", async () => {
  const messages = create_messages({
    create_message: async () => {
      throw new Error("disk full");
    },
  });
  await messages.initialize();
  await assert.rejects(
    messages.open_agent_message({
      turn_id: "turn-1",
    }),
    /disk full/,
  );
});

test("SessionMessages 并发初始化只执行一次 Store 恢复", async () => {
  let initialize_count = 0;
  let list_count = 0;
  let release_initialize;
  const initialize_gate = new Promise((resolve) => {
    release_initialize = resolve;
  });
  const messages = create_messages({
    initialize: async () => {
      initialize_count += 1;
      await initialize_gate;
    },
    list_messages: async () => {
      list_count += 1;
      return [];
    },
  });

  const first = messages.initialize();
  const second = messages.initialize();
  await Promise.resolve();
  assert.equal(initialize_count, 1);

  release_initialize();
  await Promise.all([first, second]);
  assert.equal(list_count, 1);
});

test("SessionMessages 初始化失败后允许重试", async () => {
  let initialize_count = 0;
  const messages = create_messages({
    initialize: async () => {
      initialize_count += 1;
      if (initialize_count === 1) throw new Error("restore failed");
    },
  });

  await assert.rejects(messages.initialize(), /restore failed/);
  await messages.initialize();
  assert.equal(initialize_count, 2);
});
