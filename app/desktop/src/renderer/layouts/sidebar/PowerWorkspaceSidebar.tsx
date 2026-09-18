/** 功能型 Power 在一级导航下拥有的专属 Sidebar 宿主。 */

import { useCallback, useEffect, useState } from "react";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import { BUILTIN_POWER_RENDERERS } from "@downcity/powers/renderers";
import { PowerRendererHost } from "@/features/power/lib/PowerRendererHost";
import { memo } from "react";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopPowerDefinition } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { power_renderer_notifications } from "@/lib/notification/notification_state";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";

const empty_power_route: PowerJsonObject = {};

/** 加载并渲染指定 Power 的 Sidebar 插槽。 */
export const PowerWorkspaceSidebar = memo(function PowerWorkspaceSidebar({ controller, power_id, notification_state }: {
  /** 稳定控制器。 */ readonly controller: DesktopController;
  /** 功能型 Power ID。 */ readonly power_id: string;
  /** 当前通知快照。 */ readonly notification_state: DesktopNotificationState;
}) {
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);
  const translate = use_translation("power");
  const route = use_desktop_selector(controller.stores.navigation, (state) => state.power_routes[power_id]);
  const revision = use_desktop_selector(controller.stores.navigation, (state) => state.power_revisions[power_id] ?? 0);
  const power = powers.find((item) => item.power_id === power_id);
  const { get_power, invoke_power_action, navigate_power, invalidate_power } = controller.actions;
  const [definition, set_definition] = useState<DesktopPowerDefinition>();
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    set_error("");
    if (power_id) void get_power(power_id)
      .then((next) => { if (!disposed) set_definition(next); })
      .catch((reason: unknown) => { if (!disposed) set_error(to_error_message(reason)); });
    return () => { disposed = true; };
  }, [get_power, power_id]);
  const invoke_mainview = useCallback((action_id: string, input?: PowerJsonValue) => invoke_power_action(power_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_power_action, power_id]);
  const navigate = useCallback((route: PowerJsonObject) => navigate_power(power_id, route), [navigate_power, power_id]);
  const invalidate = useCallback(() => invalidate_power(power_id), [invalidate_power, power_id]);
  if (!power?.has_sidebar || !power.has_mainview) return <SidebarPanel><SidebarContent class_name="px-3 py-8 text-center text-xs text-muted-foreground">{translate("missing_surface")}</SidebarContent></SidebarPanel>;
  return <SidebarPanel>
    {error ? <><SidebarHeader title={power.title} /><SidebarContent><div className="rounded-item bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div></SidebarContent></> : <PowerRendererHost power_id={power.power_id} sidebar_title={power.title} slot="sidebar" capabilities={power} builtin_renderer={power.source === "builtin" ? BUILTIN_POWER_RENDERERS[power.power_id] : undefined} renderer_url={definition?.renderer_url} invoke_mainview={invoke_mainview} route={route ?? empty_power_route} notifications={power_renderer_notifications(notification_state, power.power_id)} navigate={navigate} revision={revision} invalidate={invalidate} />}
  </SidebarPanel>;
});

/** 把未知加载失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
