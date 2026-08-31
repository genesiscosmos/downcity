/** Plugin 集合 Sidebar，以紧凑双层导航项展示能力与使用状态。 */

import { cn } from "@/lib/utils";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";

/** Plugin Sidebar 属性。 */
interface PluginSidebarProps {
  /** 根状态控制器。 */
  controller: DesktopViewController;
}

/** 按官方与第三方来源分组展示 Plugin。 */
export function PluginSidebar({ controller }: PluginSidebarProps) {
  const groups = [
    { source: "builtin", label: "Official" },
    { source: "installed", label: "Installed" },
  ] as const;

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {groups.map((group) => {
        const plugins = controller.plugins.filter((plugin) => plugin.source === group.source);
        if (plugins.length === 0) return null;
        return <section key={group.source} className="mb-4">
          <h3 className="px-2 pb-1.5 pt-1 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/65">{group.label}</h3>
          <div className="space-y-0.5">{plugins.map((plugin) => <PluginSidebarItem
            key={plugin.plugin_id}
            plugin={plugin}
            active={controller.selection?.kind === "plugin" && controller.selection.plugin_id === plugin.plugin_id}
            select_plugin={controller.select_plugin}
          />)}</div>
        </section>;
      })}
      {controller.plugins.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无 Plugin</div> : null}
    </div>
  </div>;
}

/** 展示单个 Plugin 的身份、选中态和当前使用摘要。 */
function PluginSidebarItem({ plugin, active, select_plugin }: {
  /** 当前 Plugin 摘要。 */
  plugin: DesktopPluginSummary;
  /** 是否为当前主视图。 */
  active: boolean;
  /** 打开指定 Plugin。 */
  select_plugin(plugin_id: string): void;
}) {
  return <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={() => select_plugin(plugin.plugin_id)}
    className={cn(
      "group flex min-h-12 w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left outline-none",
      "transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/30",
      active
        ? "bg-primary/[0.1] hover:bg-primary/[0.12]"
        : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
    )}
  >
    <span className={cn(
      "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
      active
        ? "bg-primary/10 text-primary"
        : "bg-foreground/[0.055] text-muted-foreground group-hover:bg-foreground/[0.075] group-hover:text-foreground/80",
    )}>
      <PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} />
      {plugin.agent_ids.length > 0 ? <span
        className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-muted bg-emerald-500"
        title={`已由 ${plugin.agent_ids.length} 个 Agent 使用`}
      /> : null}
    </span>
    <span className="min-w-0 flex-1">
      <span className={cn("block truncate text-xs font-medium", active ? "text-foreground" : "text-foreground/90")}>{plugin.title}</span>
      <span className="mt-0.5 block truncate text-[0.625rem] leading-3.5 text-muted-foreground/65">{plugin_usage_label(plugin)}</span>
    </span>
  </button>;
}

/** 生成不重复来源分组的 Plugin 使用摘要。 */
function plugin_usage_label(plugin: DesktopPluginSummary): string {
  const parts: string[] = [];
  if (plugin.profile_count > 0) parts.push(`${plugin.profile_count} ${plugin.profile_count === 1 ? "Profile" : "Profiles"}`);
  if (plugin.agent_ids.length > 0) parts.push(`${plugin.agent_ids.length} ${plugin.agent_ids.length === 1 ? "Agent" : "Agents"}`);
  return parts.join(" · ") || plugin.description || plugin.plugin_id;
}
