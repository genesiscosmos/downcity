/** Chat、Agent 与 Plugin 集合切换器。 */

import { TbComponents, TbMessageCircle, TbRobot } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { SidebarMode } from "@/types/DesktopView";

/** Sidebar 集合切换器属性。 */
interface SidebarViewSwitcherProps {
  /** 当前集合。 */
  active_mode: SidebarMode;
  /** 切换集合。 */
  on_change(mode: SidebarMode): void;
}

const items = [
  { mode: "chat", label: "Chat", icon: TbMessageCircle },
  { mode: "agents", label: "Agents", icon: TbRobot },
  { mode: "plugins", label: "Plugins", icon: TbComponents },
] as const;

/** 对齐 Duobox 顶部胶囊式集合切换器。 */
export function SidebarViewSwitcher({ active_mode, on_change }: SidebarViewSwitcherProps) {
  return <div role="group" aria-label="侧边栏视图" className="mx-2 mb-1 grid h-8 shrink-0 grid-cols-3 rounded-full bg-surface-subtle p-1">
    {items.map((item) => {
      const Icon = item.icon;
      const active = item.mode === active_mode;
      return <button
        key={item.mode}
        type="button"
        aria-pressed={active}
        className={cn(
          "flex h-6 min-w-0 items-center justify-center gap-1 rounded-full px-1.5 text-[0.6875rem] text-muted-foreground transition-colors duration-150 [&_svg]:size-3.5",
          active ? "bg-control-hover text-foreground" : "hover:text-foreground",
        )}
        onClick={() => on_change(item.mode)}
      >
        <Icon /><span className="truncate">{item.label}</span>
      </button>;
    })}
  </div>;
}
