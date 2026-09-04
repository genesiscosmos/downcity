/** 功能型 Plugin 在一级导航下拥有的专属 Sidebar 宿主。 */

import { useCallback, useEffect, useState } from "react";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";
import { plugin_renderer_notifications } from "@/lib/notification/notification_state";

/** 加载并渲染指定 Plugin 的 Sidebar 插槽。 */
export function PluginWorkspaceSidebar({ controller, plugin_id }: {
  /** 根状态控制器。 */ readonly controller: DesktopViewController;
  /** 功能型 Plugin ID。 */ readonly plugin_id: string;
}) {
  const plugin = controller.plugins.find((item) => item.plugin_id === plugin_id);
  const get_plugin = controller.get_plugin;
  const invoke_plugin_action = controller.invoke_plugin_action;
  const navigate_plugin = controller.navigate_plugin;
  const invalidate_plugin = controller.invalidate_plugin;
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
    {error ? <div className="mx-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : <PluginRendererHost plugin_id={plugin.plugin_id} slot="sidebar" capabilities={plugin} builtin_renderer={plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined} renderer_url={definition?.renderer_url} invoke_mainview={invoke_mainview} route={controller.plugin_routes[plugin.plugin_id] ?? {}} notifications={plugin_renderer_notifications(controller.notification_state, plugin.plugin_id)} navigate={navigate} revision={controller.plugin_revisions[plugin.plugin_id] ?? 0} invalidate={invalidate} />}
  </div>;
}

/** 把未知加载失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
