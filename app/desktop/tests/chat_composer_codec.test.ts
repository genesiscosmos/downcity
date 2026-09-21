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
        { type: "chatReference", attrs: { message_id: "message-1", role: "agent", text: "被引用的回答", preview_text: "被引用的回答" } },
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

/**
 * 代码块的判空与可发送口径必须与序列化一致。
 * 若两者不一致，会出现「按钮亮着但发送被拒」或「空消息发出去」这类现象。
 */
test("只有围栏、没有代码的代码块不算可发送内容", () => {
  const empty_block = { type: "doc", content: [{ type: "codeBlock", attrs: { language: "ts" } }] };
  assert.equal(is_chat_composer_empty(empty_block), true);
  assert.equal(is_chat_composer_empty({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "   " }] }] }), true);
  assert.equal(is_chat_composer_empty({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "const a = 1;" }] }] }), false);
});

/**
 * 队列摘要是单行文本，代码不能挤成一行。
 * 同时它决定「编辑」按钮是否可用：行内 textarea 拿不到围栏与语言，
 * 若把代码块当成可编辑，用户保存后代码会被压成普通文字。
 */
test("队列摘要保留代码行结构，且代码块不可用行内编辑", () => {
  const document = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "说明" }] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1;\nconst b = 2;" }] },
    ],
  };
  assert.equal(read_chat_composer_visible_text(document), "说明\nconst a = 1;\nconst b = 2;");
  assert.equal(has_chat_composer_rich_formatting(document), true);
  assert.equal(has_chat_composer_rich_formatting(create_chat_composer("普通文本")), false);
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
