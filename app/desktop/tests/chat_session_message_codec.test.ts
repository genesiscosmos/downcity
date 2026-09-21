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

/**
 * 代码块必须能双向往返。
 *
 * 这是最隐蔽的一条损坏路径：恢复时把 code token 降级成「带 code mark 的段落」，
 * 编辑一条含代码块的历史消息就会把它变成行内码（语言丢失、行挤在一起），
 * 再发送时围栏已经不存在。整个过程不报错。
 */
test("围栏代码块在恢复与重新投影之间保持不变", () => {
  const text = "说明：\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n结束";
  const document = create_chat_composer_from_user_parts([
    { part_id: "text", type: "text", text, state: "done" },
  ]);

  // 先确认恢复出的是真代码块，而不是带 code mark 的段落。
  const code_block = document.content?.find((node) => node.type === "codeBlock");
  assert.ok(code_block, "围栏没有恢复成 codeBlock 节点");
  assert.equal(code_block.attrs?.language, "ts");
  assert.equal(document.content?.some((node) => node.content?.some((child) => child.marks?.some((mark) => mark.type === "code"))), false, "围栏被降级成了行内码");

  // 再确认投影后围栏与语言都还在，代码体一个字符都没变。
  assert.deepEqual(project_chat_composer(document), [{ type: "text", text }]);
});

/**
 * 行内码与代码块是两种东西，不能互相混淆。
 * 行内 `code` 标记仍走 mark 路径（在段落里），只有围栏才产生块。
 */
test("行内码仍恢复为段落内的 code mark", () => {
  const document = create_chat_composer_from_user_parts([
    { part_id: "text", type: "text", text: "行内 `code` 示例", state: "done" },
  ]);
  assert.equal(document.content?.length, 1);
  assert.equal(document.content?.[0]?.type, "paragraph");
  assert.deepEqual(document.content?.[0]?.content?.[1]?.marks, [{ type: "code" }]);
});
