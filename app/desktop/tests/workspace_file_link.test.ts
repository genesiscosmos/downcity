/**
 * Workspace 文件链接与绝对路径构造测试。
 *
 * 链接必须能被 `resolve_desktop_link` 反向解析（含末尾 `:行号`），因此这里不只断言字符串，
 * 还把结果喂回那个解析器——两侧同时改坏、各自自洽的情况只能靠这条闭环发现。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { build_workspace_file_link, resolve_workspace_absolute_path } from "../src/renderer/lib/workspace/workspace_file_link.ts";
import { resolve_desktop_link } from "../src/renderer/features/navigation/lib/desktop_link.ts";

const workspaces = [{ workspace_id: "project", workspace_path: "/Users/test/project", name: "Project" }];

test("绝对路径与相对路径拼成链接，且能被链接路由解析回同一文件", () => {
  const link = build_workspace_file_link("/Users/test/project", "docs/readme.md");
  assert.equal(link, "file:///Users/test/project/docs/readme.md");
  assert.deepEqual(resolve_desktop_link(link, workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "docs/readme.md" });
});

test("带行号的链接解析回同一行", () => {
  const link = build_workspace_file_link("/Users/test/project", "src/index.ts", 45);
  assert.equal(link, "file:///Users/test/project/src/index.ts:45");
  assert.deepEqual(resolve_desktop_link(link, workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: 45 });
});

test("路径中的空格与中文逐段编码，不产生歧义的分隔符", () => {
  const link = build_workspace_file_link("/Users/test/project", "文档/设计 说明.md");
  assert.equal(link, "file:///Users/test/project/%E6%96%87%E6%A1%A3/%E8%AE%BE%E8%AE%A1%20%E8%AF%B4%E6%98%8E.md");
  assert.deepEqual(resolve_desktop_link(link, workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "文档/设计 说明.md" });
});

test("没有 Workspace 绝对路径时退化为相对路径而不是空串", () => {
  assert.equal(build_workspace_file_link(undefined, "docs/readme.md"), "docs/readme.md");
  assert.equal(build_workspace_file_link(undefined, "docs/readme.md", 3), "docs/readme.md:3");
});

test("Workspace 路径末尾的斜杠不会产生双斜杠", () => {
  assert.equal(build_workspace_file_link("/Users/test/project/", "a.md"), "file:///Users/test/project/a.md");
});

test("系统打开用的绝对路径与链接指向同一位置", () => {
  assert.equal(resolve_workspace_absolute_path("/Users/test/project", "docs/readme.md"), "/Users/test/project/docs/readme.md");
  assert.equal(resolve_workspace_absolute_path("/Users/test/project/", "/docs/readme.md"), "/Users/test/project/docs/readme.md");
  assert.equal(resolve_workspace_absolute_path(undefined, "docs/readme.md"), undefined);
});
