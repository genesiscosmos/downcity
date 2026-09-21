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

/**
 * 围栏动作的回归。
 *
 * 这条规则修的是一个真实缺陷：``` 本身是一个纯文本段落，会撞上「单个纯文本段落就发送」，
 * 于是用户敲 ``` 再回车，消息被直接发出去（发的是三个反引号）。
 */
test("段落恰好是围栏起始行时，Enter 转成代码块而不是发送", () => {
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "```" }), "code-fence");
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "```ts" }), "code-fence");
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "~~~python" }), "code-fence");
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "  ```" }), "code-fence");
  // 围栏只是段落的一部分时不算：否则「请看 ``` 这个符号」会开出一个代码块。
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "请看 ```" }), "submit");
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "" }), "submit");
});

test("展开面板里围栏仍然生效，因为代码块不提交", () => {
  // multiline 下裸 Enter 只换行，但围栏动作不提交，因此排在它之前不会破坏「回车只换行」。
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, true, { block_text: "```ts" }), "code-fence");
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, true, { block_text: "普通文字" }), "native");
});

test("代码块内的 Enter 与修饰键优先于围栏识别", () => {
  // 块内回车必须是换行，否则写不了多行代码。
  assert.equal(resolve_chat_composer_enter_action(key(), plain_paragraph, false, { block_text: "```", in_code: true }), "native");
  // 显式提交永远优先于文档结构，否则在代码块里发不出去。
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true }), plain_paragraph, false, { block_text: "```", in_code: true }), "submit");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, shiftKey: true }), plain_paragraph, false, { in_code: true }), "submit-immediately");
  assert.equal(resolve_chat_composer_enter_action(key({ metaKey: true, altKey: true }), plain_paragraph, false, { in_code: true }), "queue-paused");
});
