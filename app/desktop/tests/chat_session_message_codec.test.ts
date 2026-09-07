/** canonical User Message 与 Chat Composer 的双向转换测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUserMessagePart } from "@downcity/agent";
import { project_chat_composer } from "../src/common/chat/chatComposerProjection.ts";
import { create_chat_composer_from_user_parts } from "../src/renderer/features/chat/composer/editor/chatSessionMessageCodec.ts";

test("按原始顺序恢复并重新投影全部 User Message parts", () => {
  const parts: SessionUserMessagePart[] = [
    { part_id: "text-1", type: "text", text: "前文", state: "done" },
    { part_id: "context-1", type: "context", tag: "reference", context: "引用内容" },
    { part_id: "text-2", type: "text", text: "**粗体**和*斜体*", state: "done" },
    { part_id: "file-1", type: "file", media_type: "image/png", url: "file:///canonical/screen.png", filename: "screen.png" },
    { part_id: "data-1", type: "data", data_type: "data-selection", data: { line: 12 }, data_id: "selection-1" },
    { part_id: "text-3", type: "text", text: "- 第一项\n- 第二项", state: "done" },
  ];
  const document = create_chat_composer_from_user_parts(parts);

  assert.deepEqual(project_chat_composer(document, { allowed_attachment_urls: new Set(["file:///canonical/screen.png"]) }), [
    { type: "text", text: "前文" },
    { type: "context", tag: "reference", context: "引用内容" },
    { type: "text", text: "**粗体**和*斜体*" },
    { type: "file", media_type: "image/png", url: "file:///canonical/screen.png", filename: "screen.png" },
    { type: "data", data_type: "data-selection", data: { line: 12 }, data_id: "selection-1" },
    { type: "text", text: "- 第一项\n- 第二项" },
  ]);
});

test("恢复 ChatInput 产生的 marks、硬换行与嵌套列表", () => {
  const text = "普通 \\*符号\\* 和 **粗体**、*斜体*、~~删除~~、`` const value = `x` ``、<ins>下划线</ins>、[链接](https://example.com/a\\(b\\))\n\n- 第一行  \n  第二行\n  3. 子项";
  const document = create_chat_composer_from_user_parts([
    { part_id: "text", type: "text", text, state: "done" },
  ]);

  assert.deepEqual(project_chat_composer(document), [{ type: "text", text }]);
});
