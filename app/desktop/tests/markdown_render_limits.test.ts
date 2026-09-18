/** Desktop Markdown 超长内容保护测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  exceeds_markdown_limits,
  MARKDOWN_MAX_CHARACTERS,
  MARKDOWN_MAX_LINE_CHARACTERS,
} from "../src/renderer/components/markdown/markdown_render_limits.ts";

test("内容未超过限制时继续使用 Markdown 管线", () => {
  assert.equal(exceeds_markdown_limits("普通 Markdown 内容"), false);
  assert.equal(exceeds_markdown_limits("a\n".repeat(MARKDOWN_MAX_CHARACTERS / 2)), false);
  assert.equal(exceeds_markdown_limits(`${"a".repeat(MARKDOWN_MAX_LINE_CHARACTERS)}\n`), false);
});

test("超长内容或超长单行降级为纯文本", () => {
  assert.equal(exceeds_markdown_limits("a".repeat(MARKDOWN_MAX_CHARACTERS + 1)), true);
  assert.equal(exceeds_markdown_limits("a".repeat(MARKDOWN_MAX_LINE_CHARACTERS + 1)), true);
  assert.equal(exceeds_markdown_limits(`${"a".repeat(MARKDOWN_MAX_LINE_CHARACTERS)}\nb`), false);
});
