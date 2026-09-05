/** Chat Composer Tiptap 文档工具测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { count_chat_composer_atoms, create_chat_composer, has_chat_composer_atoms, is_chat_composer_empty, read_chat_composer_text } from "../src/renderer/features/chat/composer/editor/chatComposerCodec.ts";

test("创建并读取多行文本输入", () => {
  const document = create_chat_composer("第一行\n第二行");
  assert.equal(read_chat_composer_text(document), "第一行\n第二行");
  assert.equal(is_chat_composer_empty(document), false);
});

test("引用和附件保留在 Tiptap 文档中", () => {
  const document = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "chatReference", attrs: { message_id: "message-1", role: "assistant", text: "被引用的回答", preview_text: "被引用的回答" } },
        { type: "chatAttachment", attrs: { attachment_id: "attachment-1", filename: "screen.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" } },
        { type: "text", text: "继续分析" },
      ],
    }],
  };
  assert.equal(read_chat_composer_text(document), "继续分析");
  assert.equal(read_chat_composer_text(document, true), "> 被引用的回答\n\n继续分析");
  assert.equal(has_chat_composer_atoms(document), true);
  assert.equal(count_chat_composer_atoms(document), 2);
});

test("识别空编辑文档", () => {
  assert.equal(is_chat_composer_empty(create_chat_composer()), true);
});
