/** 功能型 Power 的独立一级 Mainview。 */

import { useCallback, useEffect, useState } from "react";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import { BUILTIN_POWER_RENDERERS } from "@downcity/powers/renderers";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { PowerRendererHost } from "@/features/power/lib/PowerRendererHost";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopPowerDefinition, DesktopPowerSummary } from "@common/types/DesktopApi";
import { power_renderer_notifications } from "@/lib/notification/notification_state";
import { use_desktop_selector } from "@/app/use_desktop";

const empty_power_route: PowerJsonObject = {};

/** 渲染 Power Mainview，并与其一级 Sidebar 共享独立路由。 */
export function PowerWorkspaceView({ power, controller }: {
  /** 当前功能型 Power。 */ readonly power: DesktopPowerSummary;
  /** Renderer 稳定控制器。 */ readonly controller: DesktopController;
}) {
  const route = use_desktop_selector(controller.stores.navigation, (state) => state.power_routes[power.power_id]);
  const revision = use_desktop_selector(controller.stores.navigation, (state) => state.power_revisions[power.power_id] ?? 0);
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const [definition, set_definition] = useState<DesktopPowerDefinition>();
  const [error, set_error] = useState("");
  const { get_power, invoke_power_action, navigate_power, invalidate_power } = controller.actions;
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    set_error("");
    void get_power(power.power_id)
      .then((next) => { if (!disposed) set_definition(next); })
      .catch((reason: unknown) => { if (!disposed) set_error(to_error_message(reason)); });
    return () => { disposed = true; };
  }, [get_power, power.power_id]);
  const invoke_mainview = useCallback((action_id: string, input?: PowerJsonValue) => invoke_power_action(power.power_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_power_action, power.power_id]);
  const navigate = useCallback((route: PowerJsonObject) => navigate_power(power.power_id, route), [navigate_power, power.power_id]);
  const invalidate = useCallback(() => invalidate_power(power.power_id), [invalidate_power, power.power_id]);
  const runtime_error = power.runtime_status === "error"
    ? power.runtime_error || "Power initialization failed"
    : "";
  return <MainViewLayout><MainViewHeader title={power.title} /><MainViewBody><main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background">{runtime_error || error ? <div className="m-4 h-fit flex-1 rounded-item bg-destructive/10 px-3 py-2 text-xs text-destructive">{runtime_error || error}</div> : <PowerRendererHost power_id={power.power_id} slot="mainview" capabilities={power} builtin_renderer={power.source === "builtin" ? BUILTIN_POWER_RENDERERS[power.power_id] : undefined} renderer_url={definition?.renderer_url} invoke_mainview={invoke_mainview} route={route ?? empty_power_route} notifications={power_renderer_notifications(notification_state, power.power_id)} navigate={navigate} revision={revision} invalidate={invalidate} />}</main></MainViewBody></MainViewLayout>;
}

/** 把未知加载失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
