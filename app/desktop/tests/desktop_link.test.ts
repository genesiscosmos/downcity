/** Desktop 用户链接路由测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_desktop_link } from "../src/renderer/lib/link/desktop_link.ts";

const workspaces = [{ workspace_id: "project", workspace_path: "/Users/test/project", name: "Project" }];

test("HTTP(S) 地址使用默认浏览器", () => {
  assert.deepEqual(resolve_desktop_link("https://example.com/docs?q=1", workspaces, {}), { kind: "external_url", url: "https://example.com/docs?q=1" });
});

test("Workspace 内绝对文件使用 Workspace 文件视图", () => {
  assert.deepEqual(resolve_desktop_link("/Users/test/project/docs/readme.md", workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "docs/readme.md" });
});

test("Workspace 外本地文件使用系统默认应用", () => {
  assert.deepEqual(resolve_desktop_link("file:///Users/test/report.pdf", workspaces, {}), { kind: "local_file", file_path: "/Users/test/report.pdf" });
});

test("Markdown 相对链接基于当前文件目录解析", () => {
  assert.deepEqual(resolve_desktop_link("../guide/start.md#install", workspaces, { workspace_id: "project", relative_path: "docs/reference/index.md" }), { kind: "workspace_file", workspace_id: "project", relative_path: "docs/guide/start.md" });
});

test("没有 Workspace 上下文时不猜测相对路径", () => {
  assert.deepEqual(resolve_desktop_link("docs/readme.md", workspaces, {}), { kind: "blocked" });
});

test("不支持的协议不会交给 WebContents 或系统", () => {
  assert.deepEqual(resolve_desktop_link("javascript:alert(1)", workspaces, {}), { kind: "blocked" });
});
