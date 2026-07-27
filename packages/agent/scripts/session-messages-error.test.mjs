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
    append_message: async () => {
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

test("open_assistant_message 透传草稿写入失败", async () => {
  const messages = create_messages({
    create_assistant_message: async () => {
      throw new Error("disk full");
    },
  });
  await messages.initialize();
  await assert.rejects(
    messages.open_assistant_message({
      turn_id: "turn-1",
    }),
    /disk full/,
  );
});
