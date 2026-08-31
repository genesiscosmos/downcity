/** Workspace 文件预览类型识别测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { is_markdown_document } from "../src/renderer/lib/workspace/workspace_file_preview.ts";

test("Markdown 与 MDX 文档使用渲染视图", () => {
  assert.equal(is_markdown_document("README.md"), true);
  assert.equal(is_markdown_document("docs/guide.MDX"), true);
});

test("名称中包含 md 的普通文本仍使用原文视图", () => {
  assert.equal(is_markdown_document("notes.md.txt"), false);
  assert.equal(is_markdown_document("src/markdown.ts"), false);
});
