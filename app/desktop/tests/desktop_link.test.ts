/** Desktop 用户链接路由测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_desktop_link, resolve_workspace_file_link } from "../src/renderer/features/navigation/lib/desktop_link.ts";

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

test("链接末尾的行号后缀不进入文件路径", () => {
  assert.deepEqual(resolve_desktop_link("/Users/test/project/src/index.ts:45", workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: 45 });
});

test("file URL 同时标注行号与列号时只取行号", () => {
  assert.deepEqual(resolve_desktop_link("file:///Users/test/project/src/index.ts:45:12", workspaces, {}), { kind: "workspace_file", workspace_id: "project", relative_path: "src/index.ts", line: 45 });
});

test("相对链接同样解析行号", () => {
  assert.deepEqual(resolve_desktop_link("../guide/start.md:8", workspaces, { workspace_id: "project", relative_path: "docs/reference/index.md" }), { kind: "workspace_file", workspace_id: "project", relative_path: "docs/guide/start.md", line: 8 });
});

test("Workspace 外文件丢弃行号并交给系统默认应用", () => {
  assert.deepEqual(resolve_desktop_link("file:///Users/test/report.pdf:3", workspaces, {}), { kind: "local_file", file_path: "/Users/test/report.pdf" });
});

test("网络地址的端口号不会被当作行号", () => {
  assert.deepEqual(resolve_desktop_link("https://example.com:8443/docs", workspaces, {}), { kind: "external_url", url: "https://example.com:8443/docs" });
});

test("当前 Workspace 内的链接可以就地打开并保留行号", () => {
  assert.deepEqual(resolve_workspace_file_link("/Users/test/project/src/index.ts:45", workspaces, "project"), { relative_path: "src/index.ts", line: 45 });
  assert.deepEqual(resolve_workspace_file_link("file:///Users/test/project/docs/readme.md", workspaces, "project"), { relative_path: "docs/readme.md" });
  assert.deepEqual(resolve_workspace_file_link("src/main.ts", workspaces, "project"), { relative_path: "src/main.ts" });
});

test("其它 Workspace 与非文件链接不返回就地打开目标", () => {
  assert.equal(resolve_workspace_file_link("/Users/test/other/src/index.ts:3", workspaces, "project"), undefined);
  assert.equal(resolve_workspace_file_link("https://example.com/docs", workspaces, "project"), undefined);
  assert.equal(resolve_workspace_file_link("#section", workspaces, "project"), undefined);
});
