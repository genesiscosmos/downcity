/** Desktop Markdown GFM 管线行为测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { markdown_remark_plugins } from "../src/renderer/components/markdown/markdown_plugins.ts";

/** 使用 Desktop 的真实 remark 管线渲染 Markdown。 */
function render_markdown(text: string): string {
  return renderToStaticMarkup(createElement(Streamdown, {
    mode: "static",
    remarkPlugins: markdown_remark_plugins,
    children: text,
  }));
}

test("保留表格、任务列表、删除线和脚注", () => {
  const html = render_markdown([
    "| 名称 | 状态 |",
    "| --- | --- |",
    "| A | 完成 |",
    "",
    "- [x] 已完成",
    "- [ ] 未完成",
    "",
    "~~删除~~",
    "",
    "脚注[^1]",
    "",
    "[^1]: 说明",
  ].join("\n"));

  assert.match(html, /<table/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<del>删除<\/del>/);
  assert.match(html, /footnote/i);
});

test("不再解析裸 URL，但保留标准 Markdown 链接", () => {
  const html = render_markdown("裸链接 https://example.com\n\n[标准链接](https://example.com)");

  assert.match(html, /https:\/\/example\.com/);
  assert.match(html, /<a[^>]+href="https:\/\/example\.com\/"/);
  assert.equal((html.match(/<a\b/g) ?? []).length, 1);
});
