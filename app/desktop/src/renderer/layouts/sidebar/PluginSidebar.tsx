/** Plugin 集合 Sidebar。 */

import { TbComponents } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { DesktopViewController } from "@/types/DesktopView";

/** Plugin Sidebar 属性。 */
interface PluginSidebarProps { /** 根状态控制器。 */ controller: DesktopViewController; }

/** 按官方与第三方来源分组展示 Plugin。 */
export function PluginSidebar({ controller }: PluginSidebarProps) {
  const groups = [
    { source: "builtin", label: "Official" },
    { source: "installed", label: "Installed" },
  ] as const;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex h-10 shrink-0 items-center px-2"><div className="min-w-0 flex-1 truncate px-1 text-xs font-semibold">Plugins</div></div>
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {groups.map((group) => {
        const plugins = controller.plugins.filter((plugin) => plugin.source === group.source);
        if (plugins.length === 0) return null;
        return <section key={group.source} className="mb-3"><h3 className="px-2 pb-1 pt-1 text-[0.625rem] font-medium uppercase text-muted-foreground">{group.label}</h3>{plugins.map((plugin) => {
          const active = controller.selection?.kind === "plugin" && controller.selection.plugin_id === plugin.plugin_id;
          return <button key={plugin.plugin_id} className={cn("flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors duration-150", active ? "bg-primary/[0.1]" : "hover:bg-foreground/[0.07]")} onClick={() => controller.select_plugin(plugin.plugin_id)}><TbComponents className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{plugin.title}</span>{plugin.agent_ids.length > 0 ? <span className="size-1.5 rounded-full bg-emerald-500" title="已启用" /> : null}</button>;
        })}</section>;
      })}
      {controller.plugins.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无 Plugin</div> : null}
    </div>
  </div>;
}
