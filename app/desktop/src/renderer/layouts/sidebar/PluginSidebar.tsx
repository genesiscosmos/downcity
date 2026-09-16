/** 完整 Plugin Catalog 的列表 Sidebar。 */

import { cn } from "@/lib/utils";
import { PluginIcon } from "@/features/plugin/lib/PluginIcon";
import { memo } from "react";
import type { DesktopController } from "@/types/DesktopView";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { use_translation } from "@/locales/i18n";

/** 始终列出全部 Plugin；点击后打开描述与配置详情。 */
export const PluginSidebar = memo(function PluginSidebar({ controller }: { /** 稳定控制器。 */ controller: DesktopController }) {
  const translate = use_translation("plugin");
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const selected_plugin_id = selection?.kind === "plugin" ? selection.plugin_id : "";
  return <SidebarPanel>
    <SidebarHeader title={translate("catalog")} />
    <SidebarContent>
      <div className="space-y-0.5">{plugins.map((plugin) => <PluginListItem key={plugin.plugin_id} plugin={plugin} active={plugin.plugin_id === selected_plugin_id} select_plugin={controller.actions.select_plugin} />)}</div>
      {!plugins.length ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">{translate("empty")}</div> : null}
    </SidebarContent>
  </SidebarPanel>;
});

/** Plugin Catalog 中的紧凑条目。 */
function PluginListItem({ plugin, active, select_plugin }: {
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** 当前是否打开该 Plugin 详情。 */ readonly active: boolean;
  /** 打开 Plugin 详情。 */ select_plugin(plugin_id: string): void;
}) {
  return <button type="button" onClick={() => select_plugin(plugin.plugin_id)} className={cn("group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30", active && "bg-interaction-selected")}>
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted-foreground"><PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{plugin.title}</span><span className="mt-0.5 block truncate text-3xs text-muted-foreground">{plugin.description}</span></span>
  </button>;
}
