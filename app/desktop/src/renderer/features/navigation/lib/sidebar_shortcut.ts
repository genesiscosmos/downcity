/**
 * Desktop Sidebar Rail 一级导航的可见顺序与数字快捷键映射。
 *
 * 图标栏顺序、tooltip 提示和 Command/Ctrl + 数字快捷键都依赖同一份顺序；
 * 官方功能型 Power 按固定优先级展示，其余功能型 Power 按标题字母序跟随。
 */

import type { DesktopPowerSummary } from "@common/types/DesktopApi";
import type { SidebarMode } from "@/types/DesktopView";

/** 官方功能型 Power 在 Rail 上的固定展示优先级；越靠前越靠近固定一级入口。 */
const rail_power_priority = ["skill", "chat", "task", "memory", "web"] as const;

/**
 * 固定一级导航入口的快捷键顺序。
 *
 * 与 `SidebarNavigationItems` 的渲染顺序必须逐项一致：那张表就是 ⌘1 / ⌘2 / ⌘3 的映射，
 * 两边一分叉，用户按 ⌘1 就会落到 Rail 上的第二个图标。
 */
const core_sidebar_modes: SidebarMode[] = ["workspace", "chat", "powers"];

/**
 * 按用户可见顺序排列 Rail 上的一级功能入口。
 *
 * 只保留真正显示在图标栏的功能型 Power（has_sidebar 且 has_mainview），
 * 并保证与 resolve_sidebar_shortcut_mode 使用同一份排序结果。
 */
export function order_rail_powers(powers: readonly DesktopPowerSummary[]): DesktopPowerSummary[] {
  const functional_powers = powers.filter((power) => power.has_sidebar && power.has_mainview);
  const prioritized: DesktopPowerSummary[] = [];
  for (const power_id of rail_power_priority) {
    const power = functional_powers.find((item) => item.power_id === power_id);
    if (power) prioritized.push(power);
  }
  return [
    ...prioritized,
    ...functional_powers
      .filter((item) => !prioritized.includes(item))
      .sort((left, right) => (left.title || left.power_id).localeCompare(right.title || right.power_id)),
  ];
}

/** 根据可见导航顺序解析 Command/Ctrl + 数字对应的一级入口。 */
export function resolve_sidebar_shortcut_mode(key: string, powers: readonly DesktopPowerSummary[]): SidebarMode | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  const power_modes = order_rail_powers(powers)
    .map((power) => `power:${power.power_id}` as SidebarMode);
  const modes: SidebarMode[] = [...core_sidebar_modes, ...power_modes];
  return modes[Number(key) - 1];
}
