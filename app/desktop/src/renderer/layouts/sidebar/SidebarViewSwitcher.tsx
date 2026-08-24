/** Chat、Agent 与 Plugin 集合切换器。 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { TbComponents, TbGhost3, TbMessageCircle } from "react-icons/tb";
import { cn } from "@/lib/utils";
import type { SidebarMode } from "@/types/DesktopView";

/** Sidebar 集合切换器属性。 */
interface SidebarViewSwitcherProps {
  /** 当前集合。 */
  active_mode: SidebarMode;
  /** 切换集合。 */
  on_change(mode: SidebarMode): void;
  /** 导航布局；left 模式显示为窄图标 rail。 */
  layout?: "top" | "left";
}

const items = [
  { mode: "chat", label: "Chat", icon: TbMessageCircle },
  { mode: "agents", label: "Agents", icon: TbGhost3 },
  { mode: "plugins", label: "Plugins", icon: TbComponents },
] as const;

/** 对齐 Duobox 顶部横向胶囊式集合切换器。 */
export function SidebarViewSwitcher({ active_mode, on_change, layout = "top" }: SidebarViewSwitcherProps) {
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
  }, [active_mode, layout, update_indicator]);

  const vertical = layout === "left";
  return <div ref={group_ref} role="group" aria-label="侧边栏视图" className={cn("relative isolate flex shrink-0", vertical ? "w-8 flex-col gap-1" : "h-8 w-fit items-center rounded-full bg-surface-subtle p-1")}>
    <span ref={indicator_ref} aria-hidden="true" className={cn("pointer-events-none absolute left-0 top-0 z-0 opacity-0 transition-[width,height,transform,opacity] duration-200 ease-out motion-reduce:transition-none", vertical ? "rounded-lg bg-interaction-selected" : "rounded-full bg-control-hover")} />
    {items.map((item) => {
      const Icon = item.icon;
      const active = item.mode === active_mode;
      const button = <button key={item.mode} type="button" aria-pressed={active} aria-label={item.label} title={vertical ? item.label : undefined} data-sidebar-view={item.mode} className={cn("group/toggle relative z-10 inline-flex shrink-0 items-center justify-center bg-transparent text-[11px] leading-none whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0", vertical ? "h-8 w-8 rounded-lg [&_svg]:size-4" : "h-6 gap-1 rounded-full px-1.5", active && "text-foreground")} onClick={() => on_change(item.mode)}><Icon />{!vertical ? <span className="truncate">{item.label}</span> : null}</button>;
      if (!vertical) return button;
      return <Tooltip.Root key={item.mode}><Tooltip.Trigger delay={300} render={button} /><Tooltip.Portal><Tooltip.Positioner side="right" sideOffset={8} className="z-50"><Tooltip.Popup className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground shadow-lg outline-none">{item.label}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
    })}
  </div>;
}
