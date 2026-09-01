/** 功能型 Plugin 的独立一级 Mainview。 */

import { useCallback, useEffect, useState } from "react";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/plugin";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";

/** 渲染 Plugin Mainview，并与其一级 Sidebar 共享独立路由。 */
export function PluginWorkspaceView({ plugin, controller }: {
  /** 当前功能型 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** Renderer 根控制器。 */ readonly controller: DesktopViewController;
}) {
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [error, set_error] = useState("");
  const get_plugin = controller.get_plugin;
  const invoke_plugin_action = controller.invoke_plugin_action;
  const navigate_plugin = controller.navigate_plugin;
  const invalidate_plugin = controller.invalidate_plugin;
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    set_error("");
    void get_plugin(plugin.plugin_id)
      .then((next) => { if (!disposed) set_definition(next); })
      .catch((reason: unknown) => { if (!disposed) set_error(to_error_message(reason)); });
    return () => { disposed = true; };
  }, [get_plugin, plugin.plugin_id]);
  const invoke_mainview = useCallback((action_id: string, input?: PluginJsonValue) => invoke_plugin_action(plugin.plugin_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, plugin.plugin_id]);
  const navigate = useCallback((route: PluginJsonObject) => navigate_plugin(plugin.plugin_id, route), [navigate_plugin, plugin.plugin_id]);
  const invalidate = useCallback(() => invalidate_plugin(plugin.plugin_id), [invalidate_plugin, plugin.plugin_id]);
  return <MainViewLayout><MainViewHeader title={plugin.title} /><MainViewBody><main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"><div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pb-10 pt-4 md:px-8 md:pt-6">{error ? <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : <PluginRendererHost plugin_id={plugin.plugin_id} slot="mainview" capabilities={plugin} builtin_renderer={plugin.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id] : undefined} renderer_url={definition?.renderer_url} invoke_mainview={invoke_mainview} route={controller.plugin_routes[plugin.plugin_id] ?? {}} navigate={navigate} revision={controller.plugin_revisions[plugin.plugin_id] ?? 0} invalidate={invalidate} />}</div></main></MainViewBody></MainViewLayout>;
}

/** 把未知加载失败转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
