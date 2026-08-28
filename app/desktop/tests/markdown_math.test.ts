/** Desktop Chat Markdown 数学公式边界转换测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { normalize_markdown_math } from "../src/renderer/lib/chat/markdown_math.ts";

test("兼容 LaTeX 方括号公式", () => {
  assert.equal(normalize_markdown_math("\\[x^2\\]"), "$x^2$");
});

test("兼容独立方括号公式且不误伤普通文本", () => {
  assert.equal(normalize_markdown_math("[ ds^2=-c^2dt^2+dx^2+dy^2+dz^2 ]"), "$ds^2=-c^2dt^2+dx^2+dy^2+dz^2$");
  assert.equal(normalize_markdown_math("[普通文本]\n\n[链接](https://example.com)"), "[普通文本]\n\n[链接](https://example.com)");
});
