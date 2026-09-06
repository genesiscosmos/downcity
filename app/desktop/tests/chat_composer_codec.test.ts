/** Chat Composer Tiptap 文档工具测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { count_chat_composer_atoms, create_chat_composer, has_chat_composer_atoms, has_chat_composer_rich_formatting, is_chat_composer_empty, read_chat_composer_text, read_chat_composer_visible_text } from "../src/renderer/features/chat/composer/editor/chatComposerCodec.ts";

test("创建并读取多行文本输入", () => {
  const document = create_chat_composer("第一行\n第二行");
  assert.equal(read_chat_composer_text(document), "第一行  \n第二行");
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

test("读取文本时复用发送边界的 Markdown 与 part 顺序", () => {
  const document = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "前文 *原样*" },
        { type: "chatReference", attrs: { text: "引用内容" } },
        { type: "chatAttachment", attrs: { filename: "screen.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" } },
        { type: "text", text: "后文", marks: [{ type: "bold" }] },
      ],
    }],
  };
  assert.equal(read_chat_composer_text(document), "前文 \\*原样\\*\n\n**后文**");
  assert.equal(read_chat_composer_text(document, true), "前文 \\*原样\\*\n\n> 引用内容\n\n**后文**");
  assert.equal(read_chat_composer_visible_text(document), "前文 *原样*后文");
  assert.equal(has_chat_composer_rich_formatting(document), true);
  assert.equal(has_chat_composer_rich_formatting(create_chat_composer("普通文本")), false);
});
