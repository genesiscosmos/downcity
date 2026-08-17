/** Chat、Agent 与 Plugin 集合切换器。 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { TbComponents, TbGhost3, TbMessageCircle } from "react-icons/tb";
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
  { mode: "agents", label: "Agents", icon: TbGhost3 },
  { mode: "plugins", label: "Plugins", icon: TbComponents },
] as const;

/** 对齐 Duobox 顶部横向胶囊式集合切换器。 */
export function SidebarViewSwitcher({ active_mode, on_change }: SidebarViewSwitcherProps) {
  const group_ref = useRef<HTMLDivElement>(null);
  const indicator_ref = useRef<HTMLSpanElement>(null);
  const update_indicator = useCallback(() => {
    const group = group_ref.current;
    const indicator = indicator_ref.current;
    const active_item = group?.querySelector<HTMLElement>('[data-sidebar-view][aria-pressed="true"]');
    if (!group || !indicator || !active_item) return;
    indicator.style.width = `${active_item.offsetWidth}px`;
    indicator.style.height = `${active_item.offsetHeight}px`;
    indicator.style.transform = `translate3d(${active_item.offsetLeft}px, ${active_item.offsetTop}px, 0)`;
    indicator.style.opacity = "1";
  }, []);

  useLayoutEffect(() => {
    update_indicator();
    const group = group_ref.current;
    if (!group) return;
    const observer = new ResizeObserver(update_indicator);
    observer.observe(group);
    group.querySelectorAll<HTMLElement>("[data-sidebar-view]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [active_mode, update_indicator]);

  return <div ref={group_ref} role="group" aria-label="侧边栏视图" className="relative isolate flex h-8 w-fit shrink-0 items-center rounded-full bg-surface-subtle p-1">
    <span ref={indicator_ref} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-control-hover opacity-0 transition-[width,height,transform,opacity] duration-200 ease-out motion-reduce:transition-none" />
    {items.map((item) => {
      const Icon = item.icon;
      const active = item.mode === active_mode;
      return <button
        key={item.mode}
        type="button"
        aria-pressed={active}
        data-sidebar-view={item.mode}
        className={cn(
          "relative z-10 flex h-6 min-w-0 items-center justify-center gap-1 rounded-full bg-transparent px-1.5 text-[0.6875rem] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5",
          active && "text-foreground",
        )}
        onClick={() => on_change(item.mode)}
      >
        <Icon /><span className="truncate">{item.label}</span>
      </button>;
    })}
  </div>;
}
