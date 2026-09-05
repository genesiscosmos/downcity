/** Desktop 按业务职责组织的页面与应用组件。 */

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";

import { PluginView } from "@/features/plugin/PluginView";
import { PluginWorkspaceView } from "@/features/plugin/PluginWorkspaceView";
import { WelcomeView } from "@/app/WelcomeView";

/** Plugin 路由只订阅当前 Plugin 引用。 */
export function PluginRouteMainView({ selection, controller }: { /** Plugin 导航目标。 */ selection: Extract<NavigationTarget, { kind: "plugin" | "plugin_workspace" }>; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const plugin = use_desktop_selector(controller.stores.catalog, (state) => state.plugins.find((item) => item.plugin_id === selection.plugin_id));
  if (!plugin) return <WelcomeView />;
  return selection.kind === "plugin"
    ? <PluginView plugin={plugin} controller={controller.actions} />
    : plugin.has_sidebar && plugin.has_mainview ? <PluginWorkspaceView plugin={plugin} controller={controller} /> : <WelcomeView />;
}
