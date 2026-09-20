/**
 * 文档预览顶栏的操作契约守卫。
 *
 * 这一组规则都是「写错不会报错、只在界面里静默走样」的那一类，因此只能靠源码断言固定：
 *
 * 1. **源码模式入口必须留在操作菜单里。** 它曾经是顶栏常驻的分段控件——占用永久位置换一次性动作，
 *    而且它是 Markdown 专属却常驻顶栏，导致顶栏形状在两类文件之间变化。
 * 2. **操作菜单在两类文件上都存在。** 只有 Markdown 才有菜单，等于把「复制全文 / 复制链接 /
 *    用系统默认应用打开」也变成了 Markdown 专属。
 * 3. **源码模式开关只在 Markdown 下出现。** 非文档没有源码形态，给了开关点下去没有可观察变化。
 * 4. **两个表面共用同一份构件。** 主视图与 Chat 面板各写一遍就会重新分叉。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");

/** 读取去掉注释的源码；注释里会引用旧写法说明为什么改，不算违规。 */
function read_without_comments(relative_path: string): string {
  return fs.readFileSync(path.join(renderer_root, relative_path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const menu_source = read_without_comments("features/workspace/components/WorkspaceFileActionsMenu.tsx");

test("操作菜单提供源码模式开关与三个命令项", () => {
  assert.match(menu_source, /DropdownMenuCheckboxItem/, "源码模式应是菜单里的开关项");
  for (const key of ["workspace.source_mode", "workspace.copy_content", "workspace.copy_link", "workspace.open_with_default"]) {
    assert.ok(menu_source.includes(key), `操作菜单缺少 ${key}`);
  }
});

test("源码模式开关只在 Markdown 文档下出现", () => {
  // 开关项必须落在 `markdown_document ?` 分支里；否则非文档也会看到它。
  const markdown_branch = /markdown_document \? <>([\s\S]*?)<\/> : null/.exec(menu_source);
  assert.ok(markdown_branch, "操作菜单里找不到 markdown_document 分支");
  assert.match(markdown_branch![1]!, /DropdownMenuCheckboxItem/, "源码模式开关不在 markdown_document 分支里");
  assert.ok(!markdown_branch![1]!.includes("workspace.copy_content"), "复制全文被误放进 Markdown 专属分支，非文档将失去它");
});

test("顶栏不再有常驻的阅读模式分段控件", () => {
  const hosts = ["features/workspace/WorkspaceFileView.tsx", "features/chat/panel/ChatFilePanel.tsx"];
  for (const host of hosts) {
    const source = read_without_comments(host);
    assert.ok(!source.includes("SegmentedControl"), `${host} 仍在顶栏渲染分段控件`);
    assert.ok(!source.includes("WorkspaceFileViewModeControl"), `${host} 仍在引用已删除的模式切换控件`);
  }
});

test("两个表面共用同一份预览构件与操作菜单", () => {
  const hosts = ["features/workspace/WorkspaceFileView.tsx", "features/chat/panel/ChatFilePanel.tsx"];
  for (const host of hosts) {
    const source = read_without_comments(host);
    assert.ok(source.includes("use_workspace_file_view_mode"), `${host} 没有复用共享的阅读模式状态`);
    assert.ok(source.includes("WorkspaceFileActionsMenu"), `${host} 没有复用共享的操作菜单`);
  }
});
