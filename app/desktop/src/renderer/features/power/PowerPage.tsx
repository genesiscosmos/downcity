/** Desktop 按业务职责组织的页面与应用组件。 */

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";

import { PowerView } from "@/features/power/PowerView";
import { PowerWorkspaceView } from "@/features/power/PowerWorkspaceView";
import { WelcomeView } from "@/app/WelcomeView";

/** Power 路由只订阅当前 Power 引用。 */
export function PowerRouteMainView({ selection, controller }: { /** Power 导航目标。 */ selection: Extract<NavigationTarget, { kind: "power" | "power_workspace" }>; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const power = use_desktop_selector(controller.stores.catalog, (state) => state.powers.find((item) => item.power_id === selection.power_id));
  if (!power) return <WelcomeView />;
  return selection.kind === "power"
    ? <PowerView power={power} controller={controller.actions} />
    : power.has_sidebar && power.has_mainview ? <PowerWorkspaceView power={power} controller={controller} /> : <WelcomeView />;
}
