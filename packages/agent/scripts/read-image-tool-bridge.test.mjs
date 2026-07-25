/**
 * @file 验证 read 图片结果会作为临时 UserMessage file part 注入模型输入。
 *
 * 关键点（中文）
 * - data URL 只进入注入消息，不保留在普通 tool result。
 * - 注入消息包含非空文本 part，能够通过 step 合并消息筛选。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { inject_read_image_user_message } from "../bin/executor/tools/file/ReadImageToolBridge.js";
import {
  pickMergedUserMessages,
  toModelMessages,
} from "../bin/executor/messages/SessionMessageCodec.js";

test("read image data is injected as a user file part", async () => {
  const data_url = "data:image/png;base64,iVBORw0KGgo=";
  const run_context = {
    session_id: "session-1",
    turn_id: "turn-1",
    injected_user_messages: [],
    deferred_persisted_user_messages: [],
    pending_assistant_file_parts: [],
  };
  const output = inject_read_image_user_message({
    tool_name: "read",
    output: {
      success: true,
      type: "image",
      file_path: "/project/input.png",
      mime_type: "image/png",
      data_url,
    },
    run_context,
  });

  assert.equal(output.data_url, undefined);
  assert.equal(output.image_attached, true);
  assert.equal(run_context.injected_user_messages.length, 1);
  const message = run_context.injected_user_messages[0];
  assert.equal(message.role, "user");
  assert.equal(message.parts[0].type, "text");
  assert.equal(message.parts[1].type, "file");
  assert.equal(message.parts[1].url, data_url);
  assert.equal(message.parts[1].mediaType, "image/png");
  assert.equal(pickMergedUserMessages([message]).length, 1);

  const model_messages = await toModelMessages([message], {});
  assert.equal(model_messages.length, 1);
  assert.equal(model_messages[0].role, "user");
  assert.match(JSON.stringify(model_messages[0]), /iVBORw0KGgo=/);
});

test("non-image tool results are unchanged", () => {
  const output = { success: true, type: "text", content: "hello" };
  const run_context = {
    session_id: "session-1",
    injected_user_messages: [],
    deferred_persisted_user_messages: [],
    pending_assistant_file_parts: [],
  };
  const result = inject_read_image_user_message({
    tool_name: "read",
    output,
    run_context,
  });
  assert.equal(result, output);
  assert.deepEqual(run_context.injected_user_messages, []);
});
