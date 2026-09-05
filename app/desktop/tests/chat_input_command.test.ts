/** ChatInput 本地 Slash 命令识别测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { create_chat_composer, resolve_chat_input_command } from "../src/renderer/features/chat/composer/editor/chatComposerCodec.ts";

test("精确 compact 文本被识别为本地命令", () => {
  assert.equal(resolve_chat_input_command(create_chat_composer("  /compact\n")), "compact");
});

test("包含额外正文时不识别为 compact 命令", () => {
  assert.equal(resolve_chat_input_command(create_chat_composer("/compact 现在")), undefined);
});

test("带附件或引用时不识别为 compact 命令", () => {
  assert.equal(resolve_chat_input_command({ type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "/compact" },
    { type: "chatAttachment", attrs: { data_url: "data:text/plain,test" } },
  ] }] }), undefined);
  assert.equal(resolve_chat_input_command({ type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "/compact" },
    { type: "chatReference", attrs: { text: "上下文" } },
  ] }] }), undefined);
});
