/**
 * Markdown frontmatter 解析测试。
 *
 * 覆盖面刻意对齐「本仓库真实文档里出现的形状」：仓库里的 `docs/*.md`、Skill 与 task.md
 * 都在用这些写法，解析器只承诺这些。不认识的形状必须落到 `raw` 而不是被丢掉或猜错，
 * 因为预览里少一行元数据比多一段原文更难被发现。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parse_workspace_document } from "../src/renderer/lib/workspace/workspace_frontmatter.ts";

test("标量与引号标量解析成键值，正文从 frontmatter 之后开始", () => {
  const parts = parse_workspace_document('---\ntitle: "发布说明"\nwhen: "time:2026-09-20T10:00:00+08:00"\n---\n\n# 正文\n');
  assert.deepEqual(parts.entries, [
    { key: "title", text: "发布说明" },
    { key: "when", text: "time:2026-09-20T10:00:00+08:00" },
  ]);
  assert.equal(parts.body, "\n# 正文\n");
  assert.equal(parts.partial, false);
});

test("嵌套映射展平为 parent.child，顺序保持文件顺序", () => {
  const parts = parse_workspace_document("---\nname: skill\nmetadata:\n  version: 2.0.0\n  owner: team\n---\n正文");
  assert.deepEqual(parts.entries, [
    { key: "name", text: "skill" },
    { key: "metadata.version", text: "2.0.0" },
    { key: "metadata.owner", text: "team" },
  ]);
});

test("行内序列与块序列都解析成条目列表", () => {
  const inline = parse_workspace_document("---\ntags: [seo, \"content, strategy\", a]\n---\n");
  assert.deepEqual(inline.entries, [{ key: "tags", items: ["seo", "content, strategy", "a"] }]);

  const block = parse_workspace_document("---\ntags:\n  - seo\n  - content\n---\n");
  assert.deepEqual(block.entries, [{ key: "tags", items: ["seo", "content"] }]);
});

test("块标量按原文展示，不会混进正文", () => {
  const parts = parse_workspace_document("---\ndescription: |\n  第一行\n  第二行\ntitle: 之后的字段\n---\n正文");
  assert.equal(parts.partial, true);
  assert.deepEqual(parts.entries[0], { key: "description", raw: "|\n第一行\n第二行" });
  // 块标量之后仍要继续解析，不能把它后面的字段吞掉。
  assert.deepEqual(parts.entries[1], { key: "title", text: "之后的字段" });
  assert.equal(parts.body, "正文");
});

test("对象序列与更深嵌套按原文展示并标记 partial", () => {
  const parts = parse_workspace_document("---\nsteps:\n  - title: 一\n    run: x\n---\n");
  assert.equal(parts.partial, true);
  assert.equal(parts.entries[0]!.key, "steps");
  assert.ok(parts.entries[0]!.raw?.includes("title: 一"));
});

test("没有 frontmatter 或以分隔线开头的普通文档整份按正文处理", () => {
  const plain = parse_workspace_document("# 标题\n\n正文");
  assert.deepEqual(plain, { entries: [], body: "# 标题\n\n正文", partial: false });

  // 未闭合的头部不是 frontmatter：否则整份文档会被当成元数据。
  const unclosed = parse_workspace_document("---\ntitle: 未闭合\n\n正文");
  assert.deepEqual(unclosed.entries, []);
  assert.equal(unclosed.body, "---\ntitle: 未闭合\n\n正文");
});

test("注释行与空行不产生字段", () => {
  const parts = parse_workspace_document("---\n# 说明\ntitle: a\n\nstatus: final\n---\n");
  assert.deepEqual(parts.entries, [{ key: "title", text: "a" }, { key: "status", text: "final" }]);
});

test("空值字段保留为空文本，而不是消失", () => {
  const parts = parse_workspace_document("---\ntitle: a\nnote:\n---\n");
  assert.deepEqual(parts.entries, [{ key: "title", text: "a" }, { key: "note", text: "" }]);
});
