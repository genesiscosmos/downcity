/** Desktop 左侧一级导航的数字快捷键映射。 */

import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import type { SidebarMode } from "@/types/DesktopView";

/** 根据可见导航顺序解析 Command/Ctrl + 数字对应的一级入口。 */
export function resolve_sidebar_shortcut_mode(key: string, plugins: readonly DesktopPluginSummary[]): SidebarMode | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  const plugin_modes = plugins
    .filter((plugin) => plugin.has_sidebar && plugin.has_mainview)
    .map((plugin) => `plugin:${plugin.plugin_id}` as SidebarMode);
  const modes: SidebarMode[] = ["chat", "workspace", "plugins", ...plugin_modes];
  return modes[Number(key) - 1];
}
