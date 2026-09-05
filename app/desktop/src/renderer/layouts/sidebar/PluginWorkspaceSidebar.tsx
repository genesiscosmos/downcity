/** 功能型 Plugin 在一级导航下拥有的专属 Sidebar 宿主。 */

import { useCallback, useEffect, useState } from "react";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import { PluginRendererHost } from "@/features/plugin/lib/PluginRendererHost";
import { memo } from "react";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopPluginDefinition } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarHeader } from "./SidebarHeader";
import { plugin_renderer_notifications } from "@/lib/notification/notification_state";
import { use_desktop_selector } from "@/app/use_desktop";

const empty_plugin_route: PluginJsonObject = {};

/** 加载并渲染指定 Plugin 的 Sidebar 插槽。 */
export const PluginWorkspaceSidebar = memo(function PluginWorkspaceSidebar({ controller, plugin_id, notification_state }: {
  /** 稳定控制器。 */ readonly controller: DesktopController;
  /** 功能型 Plugin ID。 */ readonly plugin_id: string;
  /** 当前通知快照。 */ readonly notification_state: DesktopNotificationState;
}) {
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const route = use_desktop_selector(controller.stores.navigation, (state) => state.plugin_routes[plugin_id]);
  const revision = use_desktop_selector(controller.stores.navigation, (state) => state.plugin_revisions[plugin_id] ?? 0);
  const plugin = plugins.find((item) => item.plugin_id === plugin_id);
  const { get_plugin, invoke_plugin_action, navigate_plugin, invalidate_plugin } = controller.actions;
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [error, set_error] = useState("");
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    set_error("");
    if (plugin_id) void get_plugin(plugin_id)
      .then((next) => { if (!disposed) set_definition(next); })
      .catch((reason: unknown) => { if (!disposed) set_error(to_error_message(reason)); });
    return () => { disposed = true; };
  }, [get_plugin, plugin_id]);
  const invoke_mainview = useCallback((action_id: string, input?: PluginJsonValue) => invoke_plugin_action(plugin_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, plugin_id]);
  const navigate = useCallback((route: PluginJsonObject) => navigate_plugin(plugin_id, route), [navigate_plugin, plugin_id]);
  const invalidate = useCallback(() => invalidate_plugin(plugin_id), [invalidate_plugin, plugin_id]);
  if (!plugin?.has_sidebar || !plugin.has_mainview) return <div className="px-3 py-8 text-center text-xs text-muted-foreground">Plugin 未提供功能界面</div>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <SidebarHeader title={plugin.title} />
    {error ? <div className="mx-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : <PluginRendererHost plugin_id={plugin.plugin_id} slot="sidebar" capabilities={plugin} builtin_renderer={plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined} renderer_url={definition?.renderer_url} invoke_mainview={invoke_mainview} route={route ?? empty_plugin_route} notifications={plugin_renderer_notifications(notification_state, plugin.plugin_id)} navigate={navigate} revision={revision} invalidate={invalidate} />}
  </div>;
});

/** 把未知加载失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
