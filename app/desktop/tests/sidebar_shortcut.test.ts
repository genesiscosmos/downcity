/** Desktop 左侧一级导航数字快捷键测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPluginSummary } from "../src/common/types/DesktopApi.ts";
import { resolve_sidebar_shortcut_mode } from "../src/renderer/features/navigation/lib/sidebar_shortcut.ts";

const plugins = [
  { plugin_id: "files", has_sidebar: true, has_mainview: true },
  { plugin_id: "hidden", has_sidebar: false, has_mainview: true },
  { plugin_id: "tasks", has_sidebar: true, has_mainview: true },
] as DesktopPluginSummary[];

test("前三个数字映射到固定一级导航", () => {
  assert.equal(resolve_sidebar_shortcut_mode("1", plugins), "chat");
  assert.equal(resolve_sidebar_shortcut_mode("2", plugins), "workspace");
  assert.equal(resolve_sidebar_shortcut_mode("3", plugins), "plugins");
});

test("后续数字只映射实际显示在图标栏的 Plugin", () => {
  assert.equal(resolve_sidebar_shortcut_mode("4", plugins), "plugin:files");
  assert.equal(resolve_sidebar_shortcut_mode("5", plugins), "plugin:tasks");
  assert.equal(resolve_sidebar_shortcut_mode("6", plugins), undefined);
  assert.equal(resolve_sidebar_shortcut_mode("0", plugins), undefined);
});
