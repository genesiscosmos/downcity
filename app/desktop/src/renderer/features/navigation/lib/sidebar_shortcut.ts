/**
 * Desktop Sidebar Rail 一级导航的可见顺序与数字快捷键映射。
 *
 * 图标栏顺序、tooltip 提示和 Command/Ctrl + 数字快捷键都依赖同一份顺序；
 * 官方功能型 Plugin 按固定优先级展示，其余功能型 Plugin 按标题字母序跟随。
 */

import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import type { SidebarMode } from "@/types/DesktopView";

/** 官方功能型 Plugin 在 Rail 上的固定展示优先级；越靠前越靠近固定一级入口。 */
const rail_plugin_priority = ["skill", "chat", "task"] as const;

/** 固定一级导航入口的快捷键顺序。 */
const core_sidebar_modes: SidebarMode[] = ["chat", "workspace", "plugins"];

/**
 * 按用户可见顺序排列 Rail 上的一级功能入口。
 *
 * 只保留真正显示在图标栏的功能型 Plugin（has_sidebar 且 has_mainview），
 * 并保证与 resolve_sidebar_shortcut_mode 使用同一份排序结果。
 */
export function order_rail_plugins(plugins: readonly DesktopPluginSummary[]): DesktopPluginSummary[] {
  const functional_plugins = plugins.filter((plugin) => plugin.has_sidebar && plugin.has_mainview);
  const prioritized: DesktopPluginSummary[] = [];
  for (const plugin_id of rail_plugin_priority) {
    const plugin = functional_plugins.find((item) => item.plugin_id === plugin_id);
    if (plugin) prioritized.push(plugin);
  }
  return [
    ...prioritized,
    ...functional_plugins
      .filter((item) => !prioritized.includes(item))
      .sort((left, right) => (left.title || left.plugin_id).localeCompare(right.title || right.plugin_id)),
  ];
}

/** 根据可见导航顺序解析 Command/Ctrl + 数字对应的一级入口。 */
export function resolve_sidebar_shortcut_mode(key: string, plugins: readonly DesktopPluginSummary[]): SidebarMode | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  const plugin_modes = order_rail_plugins(plugins)
    .map((plugin) => `plugin:${plugin.plugin_id}` as SidebarMode);
  const modes: SidebarMode[] = [...core_sidebar_modes, ...plugin_modes];
  return modes[Number(key) - 1];
}
