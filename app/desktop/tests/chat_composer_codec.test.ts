/** Chat Composer 文档与 Desktop 输入协议转换测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { decode_chat_composer, encode_chat_composer } from "../src/renderer/lib/chat/editor/chatComposerCodec.ts";

test("保留正文、附件和结构化引用", () => {
  const document = encode_chat_composer(
    "第一行\n第二行",
    [{ filename: "screen.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" }],
    [{ message_id: "message-1", role: "assistant", text: "被引用的回答" }],
  );

  assert.deepEqual(decode_chat_composer(document), {
    text: "第一行\n第二行",
    files: [{ filename: "screen.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" }],
    references: [{ message_id: "message-1", role: "assistant", text: "被引用的回答" }],
  });
});

test("空编辑文档转换为空输入", () => {
  assert.deepEqual(decode_chat_composer({ type: "doc", content: [{ type: "paragraph" }] }), {
    text: "",
    files: [],
    references: [],
  });
});
