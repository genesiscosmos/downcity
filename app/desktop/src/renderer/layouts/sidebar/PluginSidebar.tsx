/** 完整 Plugin Catalog 的列表 Sidebar。 */

import { cn } from "@/lib/utils";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";

/** 始终列出全部 Plugin；点击后打开描述与配置详情。 */
export function PluginSidebar({ controller }: { /** 根状态控制器。 */ controller: DesktopViewController }) {
  const selected_plugin_id = controller.selection?.kind === "plugin" ? controller.selection.plugin_id : "";
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <SidebarHeader title="Plugins" />
    <div className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <div className="space-y-0.5">{controller.plugins.map((plugin) => <PluginListItem key={plugin.plugin_id} plugin={plugin} active={plugin.plugin_id === selected_plugin_id} select_plugin={controller.select_plugin} />)}</div>
      {!controller.plugins.length ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无 Plugin</div> : null}
    </div>
  </div>;
}

/** Plugin Catalog 中的紧凑条目。 */
function PluginListItem({ plugin, active, select_plugin }: {
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** 当前是否打开该 Plugin 详情。 */ readonly active: boolean;
  /** 打开 Plugin 详情。 */ select_plugin(plugin_id: string): void;
}) {
  return <button type="button" onClick={() => select_plugin(plugin.plugin_id)} className={cn("group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30", active && "bg-interaction-selected")}>
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-muted-foreground"><PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{plugin.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground/65">{plugin.description}</span></span>
  </button>;
}
