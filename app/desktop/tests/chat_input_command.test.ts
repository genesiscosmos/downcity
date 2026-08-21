/** ChatInput 本地 Slash 命令识别测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_chat_input_command } from "../src/renderer/lib/chat/chat_input_command.ts";

test("精确 compact 文本被识别为本地命令", () => {
  assert.equal(resolve_chat_input_command({ text: "  /compact\n", files: [], references: [] }), "compact");
});

test("包含额外正文时不识别为 compact 命令", () => {
  assert.equal(resolve_chat_input_command({ text: "/compact 现在", files: [], references: [] }), undefined);
});

test("带附件或引用时不识别为 compact 命令", () => {
  assert.equal(resolve_chat_input_command({
    text: "/compact",
    files: [{ filename: "context.txt", media_type: "text/plain", data_url: "data:text/plain,test" }],
    references: [],
  }), undefined);
  assert.equal(resolve_chat_input_command({
    text: "/compact",
    files: [],
    references: [{ message_id: "message-1", role: "user", text: "上下文" }],
  }), undefined);
});
