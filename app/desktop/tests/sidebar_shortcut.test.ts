/** Desktop 左侧一级导航数字快捷键与 Rail 顺序测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPluginSummary } from "../src/common/types/DesktopApi.ts";
import { order_rail_plugins, resolve_sidebar_shortcut_mode } from "../src/renderer/features/navigation/lib/sidebar_shortcut.ts";

/** 构造最小可用的 Plugin 摘要。 */
function plugin(plugin_id: string, title = plugin_id): DesktopPluginSummary {
  return {
    plugin_id,
    title,
    description: "",
    source: "builtin",
    has_main: true,
    has_sidebar: true,
    has_mainview: true,
    has_config: false,
  };
}

const plugins = [
  plugin("files", "Files"),
  { ...plugin("hidden", "Hidden"), has_mainview: false },
  plugin("task", "Task"),
  plugin("chat", "Channels"),
  plugin("skill", "Skills"),
] as DesktopPluginSummary[];

test("官方功能型 Plugin 按固定优先级排序，其余按标题跟随", () => {
  assert.deepEqual(order_rail_plugins(plugins).map((item) => item.plugin_id), ["skill", "chat", "task", "files"]);
});

test("无 Sidebar 的 Plugin 不进入 Rail 顺序", () => {
  const hidden_only = [{ ...plugin("hidden", "Hidden"), has_mainview: false }];
  assert.deepEqual(order_rail_plugins(hidden_only), []);
});

test("前三个数字映射到固定一级导航", () => {
  assert.equal(resolve_sidebar_shortcut_mode("1", plugins), "chat");
  assert.equal(resolve_sidebar_shortcut_mode("2", plugins), "workspace");
  assert.equal(resolve_sidebar_shortcut_mode("3", plugins), "plugins");
});

test("后续数字与 Rail 图标顺序一致", () => {
  assert.equal(resolve_sidebar_shortcut_mode("4", plugins), "plugin:skill");
  assert.equal(resolve_sidebar_shortcut_mode("5", plugins), "plugin:chat");
  assert.equal(resolve_sidebar_shortcut_mode("6", plugins), "plugin:task");
  assert.equal(resolve_sidebar_shortcut_mode("7", plugins), "plugin:files");
  assert.equal(resolve_sidebar_shortcut_mode("8", plugins), undefined);
  assert.equal(resolve_sidebar_shortcut_mode("0", plugins), undefined);
});
