/** Chat Composer Enter 系列快捷键契约测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  is_single_plain_text_paragraph,
  resolve_chat_composer_enter_action,
  type ChatComposerEnterKey,
} from "../src/renderer/features/chat/composer/editor/chatComposerKeymap.ts";

const plain_paragraph = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
const key = (overrides: Partial<ChatComposerEnterKey> = {}): ChatComposerEnterKey => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  ...overrides,
});

test("裸 Enter 只提交单个纯文本段落", () => {
  assert.equal(is_single_plain_text_paragraph(plain_paragraph), true);
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph), "submit");
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "one" }] },
    { type: "paragraph", content: [{ type: "text", text: "two" }] },
  ] }), "native");
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [{ type: "bulletList" }] }), "native");
});

test("inline node、硬换行和空白段落不会被裸 Enter 提交", () => {
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "hello" },
    { type: "chatAttachment", attrs: { filename: "note.txt" } },
  ] }] }), "native");
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "hello" },
    { type: "hardBreak" },
    { type: "text", text: "world" },
  ] }] }), "native");
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [{ type: "paragraph" }] }), "native");
  assert.equal(resolve_chat_composer_enter_action(key(), { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] }), "native");
});

test("修饰键行为与文档结构及队列状态无关", () => {
  const complex_document = { type: "doc", content: [{ type: "bulletList" }, { type: "paragraph" }] };
  assert.equal(resolve_chat_composer_enter_action(key({ shiftKey: true }), plain_paragraph), "native");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true }), complex_document), "submit");
  assert.equal(resolve_chat_composer_enter_action(key({ ctrlKey: true }), complex_document), "submit");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, altKey: true }), complex_document), "queue-paused");
  assert.equal(resolve_chat_composer_enter_action(key({ ctrlKey: true, altKey: true }), complex_document), "queue-paused");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, shiftKey: true }), complex_document), "submit-immediately");
  assert.equal(resolve_chat_composer_enter_action(key({ ctrlKey: true, shiftKey: true }), complex_document), "submit-immediately");
});

test("多行模式下裸 Enter 只换行，显式提交键仍然生效", () => {
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, true), "native");
  assert.equal(resolve_chat_composer_enter_action(key({ shiftKey: true }), plain_paragraph, true), "native");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true }), plain_paragraph, true), "submit");
  assert.equal(resolve_chat_composer_enter_action(key({ ctrlKey: true }), plain_paragraph, true), "submit");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, shiftKey: true }), plain_paragraph, true), "submit-immediately");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, altKey: true }), plain_paragraph, true), "queue-paused");
  // 默认行为不变：多行模式不能反过来影响正文里的普通输入框。
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph), "submit");
});

test("IME 合成和 Alt + Enter 保留原生行为", () => {
  assert.equal(resolve_chat_composer_enter_action(key({ isComposing: true }), plain_paragraph), "native");
  assert.equal(resolve_chat_composer_enter_action(key({ altKey: true }), plain_paragraph), "native");
});
