/** Plugin 工作区列表与 Plugin 专属 Sidebar 宿主。 */

import { useCallback, useEffect, useState } from "react";
import { TbArrowLeft } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";

/** 根据当前导航目标显示 Plugin List 或选中 Plugin 的专属 Sidebar。 */
export function PluginSidebar({ controller }: { /** 根状态控制器。 */ controller: DesktopViewController }) {
  const selected_plugin_id = controller.selection?.kind === "plugin" ? controller.selection.plugin_id : "";
  const selected = selected_plugin_id
    ? controller.plugins.find((plugin) => plugin.plugin_id === selected_plugin_id)
    : undefined;
  const get_plugin = controller.get_plugin;
  const invoke_plugin_action = controller.invoke_plugin_action;
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    if (selected_plugin_id) void get_plugin(selected_plugin_id).then((next) => { if (!disposed) set_definition(next); });
    return () => { disposed = true; };
  }, [get_plugin, selected_plugin_id]);
  const invoke_mainview = useCallback((action_id: string, input?: import("@downcity/plugin").PluginJsonValue) => invoke_plugin_action(selected_plugin_id, {
    surface: "mainview",
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [invoke_plugin_action, selected_plugin_id]);

  if (!selected) return <PluginList controller={controller} />;
  const renderer = selected.source === "builtin" ? BUILTIN_PLUGIN_RENDERERS[selected.plugin_id] : undefined;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex h-9 shrink-0 items-center gap-1 px-2 pb-1">
      <Button size="icon" title="返回 Plugin 列表" aria-label="返回 Plugin 列表" onClick={controller.select_plugins}><TbArrowLeft /></Button>
      <PluginIcon plugin_id={selected.plugin_id} icon_url={selected.icon_url} />
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-foreground">{selected.title}</span>
    </div>
    <PluginRendererHost
      plugin_id={selected.plugin_id}
      slot="sidebar"
      capabilities={selected}
      builtin_renderer={renderer}
      renderer_url={definition?.renderer_url}
      invoke_mainview={invoke_mainview}
      route={controller.plugin_route}
      navigate={controller.navigate_plugin}
    />
  </div>;
}

/** 列出真正提供业务工作区的 Plugin。 */
function PluginList({ controller }: { /** 根状态控制器。 */ controller: DesktopViewController }) {
  const plugins = controller.plugins.filter((plugin) => plugin.has_sidebar && plugin.has_mainview);
  return <div className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
    <h3 className="px-2 pb-1.5 pt-1 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">Plugins</h3>
    <div className="space-y-0.5">{plugins.map((plugin) => <PluginListItem key={plugin.plugin_id} plugin={plugin} select_plugin={controller.select_plugin} />)}</div>
    {!plugins.length ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无业务 Plugin</div> : null}
  </div>;
}

/** Plugin List 中的一个紧凑入口。 */
function PluginListItem({ plugin, select_plugin }: {
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** 打开 Plugin 工作区。 */ select_plugin(plugin_id: string): void;
}) {
  return <button type="button" onClick={() => select_plugin(plugin.plugin_id)} className={cn("group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30")}>
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-muted-foreground"><PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{plugin.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground/65">{plugin.description}</span></span>
  </button>;
}
