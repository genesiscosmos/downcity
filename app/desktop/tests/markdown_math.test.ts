/** Desktop Chat Markdown 数学公式边界转换测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { markdown_rehype_plugins, markdown_remark_plugins } from "../src/renderer/components/markdown/markdown_plugins.ts";
import { normalize_markdown_math } from "../src/renderer/components/markdown/normalize_markdown_math.ts";

test("兼容 LaTeX 方括号公式", () => {
  assert.equal(normalize_markdown_math("\\[x^2\\]"), "$x^2$");
});

test("兼容独立方括号公式且不误伤普通文本", () => {
  assert.equal(normalize_markdown_math("[ ds^2=-c^2dt^2+dx^2+dy^2+dz^2 ]"), "$ds^2=-c^2dt^2+dx^2+dy^2+dz^2$");
  assert.equal(normalize_markdown_math("[普通文本]\n\n[链接](https://example.com)"), "[普通文本]\n\n[链接](https://example.com)");
});

test("Markdown 管线保留 KaTeX 样式类", () => {
  const html = renderToStaticMarkup(createElement(Streamdown, {
    mode: "static",
    rehypePlugins: markdown_rehype_plugins,
    remarkPlugins: markdown_remark_plugins,
    children: "Inline: $x^2$",
  }));

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-html"/);
});

test("公式渲染前清理不安全 HTML", () => {
  const html = renderToStaticMarkup(createElement(Streamdown, {
    mode: "static",
    rehypePlugins: markdown_rehype_plugins,
    remarkPlugins: markdown_remark_plugins,
    children: "<script>alert(1)</script>\n\n$x^2$",
  }));

  assert.doesNotMatch(html, /<script/);
  assert.match(html, /class="katex"/);
});
