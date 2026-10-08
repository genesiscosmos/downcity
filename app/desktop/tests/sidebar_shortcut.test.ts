/** Desktop 左侧一级导航数字快捷键与 Rail 顺序测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPowerSummary } from "../src/common/types/DesktopApi.ts";
import { order_rail_powers, resolve_sidebar_shortcut_mode } from "../src/renderer/features/navigation/lib/sidebar_shortcut.ts";

/** 构造最小可用的 Power 摘要。 */
function power(power_id: string, title = power_id): DesktopPowerSummary {
  return {
    power_id,
    title,
    description: "",
    source: "builtin",
    has_main: true,
    has_sidebar: true,
    has_mainview: true,
    has_config: false,
  };
}

const powers = [
  power("files", "Files"),
  { ...power("hidden", "Hidden"), has_mainview: false },
  power("task", "Task"),
  power("messenger", "Messengers"),
  power("skill", "Skills"),
] as DesktopPowerSummary[];

test("官方功能型 Power 按固定优先级排序，其余按标题跟随", () => {
  assert.deepEqual(order_rail_powers(powers).map((item) => item.power_id), ["skill", "messenger", "task", "files"]);
});

test("无 Sidebar 的 Power 不进入 Rail 顺序", () => {
  const hidden_only = [{ ...power("hidden", "Hidden"), has_mainview: false }];
  assert.deepEqual(order_rail_powers(hidden_only), []);
});

test("前两个数字映射到固定一级导航，功能型 Power 从第三个数字起跟随", () => {
  assert.equal(resolve_sidebar_shortcut_mode("1", powers), "workspace");
  assert.equal(resolve_sidebar_shortcut_mode("2", powers), "chat");
});

test("后续数字与 Rail 图标顺序一致", () => {
  assert.equal(resolve_sidebar_shortcut_mode("3", powers), "power:skill");
  assert.equal(resolve_sidebar_shortcut_mode("4", powers), "power:messenger");
  assert.equal(resolve_sidebar_shortcut_mode("5", powers), "power:task");
  assert.equal(resolve_sidebar_shortcut_mode("6", powers), "power:files");
  assert.equal(resolve_sidebar_shortcut_mode("7", powers), undefined);
  assert.equal(resolve_sidebar_shortcut_mode("0", powers), undefined);
});
