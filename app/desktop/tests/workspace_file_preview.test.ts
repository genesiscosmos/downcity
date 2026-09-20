/** Workspace 文件预览类型识别与初始阅读模式测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { is_markdown_document, resolve_default_view_mode } from "../src/renderer/lib/workspace/workspace_file_preview.ts";

test("Markdown 与 MDX 文档使用渲染视图", () => {
  assert.equal(is_markdown_document("README.md"), true);
  assert.equal(is_markdown_document("docs/guide.MDX"), true);
});

test("名称中包含 md 的普通文本仍使用原文视图", () => {
  assert.equal(is_markdown_document("notes.md.txt"), false);
  assert.equal(is_markdown_document("src/markdown.ts"), false);
});

test("Markdown 文档默认进预览，其它文件只有源码一种形态", () => {
  assert.equal(resolve_default_view_mode("docs/guide.md"), "preview");
  assert.equal(resolve_default_view_mode("src/index.ts"), "source");
});

test("带行号的链接直接进源码，否则目标行会被排版隐藏", () => {
  assert.equal(resolve_default_view_mode("docs/guide.md", 45), "source");
  assert.equal(resolve_default_view_mode("docs/guide.md", undefined), "preview");
});
