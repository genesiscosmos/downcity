/** Tiptap Chat Input 到 Session Prompt parts 的转换测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { chat_input_to_session_query } from "../src/main/agent/ChatInput.ts";

test("按照 Tiptap 节点顺序生成 text、context 与 file parts", () => {
  const query = chat_input_to_session_query({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "chatReference", attrs: { message_id: "message-1", role: "assistant", text: "此前回答", preview_text: "此前回答" } },
        { type: "chatAttachment", attrs: { attachment_id: "attachment-1", filename: "design.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" } },
        { type: "text", text: "分析一下这张图" },
      ],
    }],
  });

  assert.deepEqual(query, [
    { type: "context", tag: "reference", context: "此前回答" },
    { type: "file", media_type: "image/png", url: "data:image/png;base64,AA==", filename: "design.png" },
    { type: "text", text: "分析一下这张图" },
  ]);
});

test("纯文本 Chat Input 仍使用标准 text part", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
      { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
    ],
  }), [{ type: "text", text: "第一段\n第二段" }]);
});

test("拒绝空输入和无效附件", () => {
  assert.throws(() => chat_input_to_session_query({ type: "paragraph" }), /chat input must be a Tiptap document/);
  assert.throws(() => chat_input_to_session_query({ type: "doc", content: [{ type: "paragraph" }] }), /message is required/);
  assert.throws(() => chat_input_to_session_query({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "chatAttachment", attrs: { data_url: "/tmp/image.png" } }] }],
  }), /attachment must use a data URL/);
});
