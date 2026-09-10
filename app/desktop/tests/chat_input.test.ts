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
        { type: "chatReference", attrs: { message_id: "message-1", role: "agent", text: "此前回答", preview_text: "此前回答" } },
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
  }), [{ type: "text", text: "第一段\n\n第二段" }]);
});

test("把支持的文本 marks 稳定序列化为 Markdown", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "普通 *符号* 和 " },
        { type: "text", text: "粗体", marks: [{ type: "bold" }] },
        { type: "text", text: "、" },
        { type: "text", text: "斜体", marks: [{ type: "italic" }] },
        { type: "text", text: "、" },
        { type: "text", text: "删除", marks: [{ type: "strike" }] },
        { type: "text", text: "、" },
        { type: "text", text: "const value = `x`", marks: [{ type: "code" }] },
        { type: "text", text: "、" },
        { type: "text", text: "下划线", marks: [{ type: "underline" }] },
        { type: "text", text: "、" },
        { type: "text", text: "链接", marks: [{ type: "link", attrs: { href: "https://example.com/a(b)" } }] },
      ],
    }],
  }), [{
    type: "text",
    text: "普通 \\*符号\\* 和 **粗体**、*斜体*、~~删除~~、`` const value = `x` ``、<ins>下划线</ins>、[链接](https://example.com/a\\(b\\))",
  }]);
});

test("保留硬换行和嵌套列表结构", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "第一行" }, { type: "hardBreak" }, { type: "text", text: "第二行" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "第一项" }] },
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项 A" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项 B" }] }] },
                ],
              },
            ],
          },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第二项" }] }] },
        ],
      },
    ],
  }), [{ type: "text", text: "第一行  \n第二行\n\n- 第一项\n  3. 子项 A\n  4. 子项 B\n- 第二项" }]);
});

test("原子节点不会改变前后正文的 canonical 顺序", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "前文" },
        { type: "chatReference", attrs: { text: "引用内容" } },
        { type: "text", text: "中间" },
        { type: "chatAttachment", attrs: { filename: "design.png", media_type: "image/png", data_url: "data:image/png;base64,AA==" } },
        { type: "text", text: "后文" },
      ],
    }],
  }), [
    { type: "text", text: "前文" },
    { type: "context", tag: "reference", context: "引用内容" },
    { type: "text", text: "中间" },
    { type: "file", media_type: "image/png", url: "data:image/png;base64,AA==", filename: "design.png" },
    { type: "text", text: "后文" },
  ]);
});

test("拒绝空输入和无效附件", () => {
  assert.throws(() => chat_input_to_session_query({ type: "paragraph" }), /chat input must be a Tiptap document/);
  assert.throws(() => chat_input_to_session_query({ type: "doc", content: [{ type: "paragraph" }] }), /message is required/);
  assert.throws(() => chat_input_to_session_query({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "chatAttachment", attrs: { data_url: "/tmp/image.png" } }] }],
  }), /attachment must use a data URL or an existing canonical URL/);
});

test("只在显式 allowlist 中复用历史 canonical 附件", () => {
  const document = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "chatAttachment", attrs: { filename: "old.png", media_type: "image/png", data_url: "file:///canonical/old.png" } }] }],
  };
  assert.throws(() => chat_input_to_session_query(document), /existing canonical URL/);
  assert.deepEqual(chat_input_to_session_query(document, { allowed_attachment_urls: new Set(["file:///canonical/old.png"]) }), [
    { type: "file", filename: "old.png", media_type: "image/png", url: "file:///canonical/old.png" },
  ]);
});

test("单独的 Markdown marker 仍被视为用户正文", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "-" }] }],
  }), [{ type: "text", text: "-" }]);
});

test("普通文本不会在发送后被重新解释成 Markdown 块", () => {
  assert.deepEqual(chat_input_to_session_query({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "---" }] },
      { type: "paragraph", content: [{ type: "text", text: "# 标题" }] },
      { type: "paragraph", content: [{ type: "text", text: "- 列表" }] },
      { type: "paragraph", content: [{ type: "text", text: "1. 列表" }] },
      { type: "paragraph", content: [{ type: "text", text: "> 引用" }] },
      { type: "paragraph", content: [{ type: "text", text: "===" }] },
    ],
  }), [{ type: "text", text: "\\---\n\n\\# 标题\n\n\\- 列表\n\n1\\. 列表\n\n\\> 引用\n\n\\===" }]);
});
