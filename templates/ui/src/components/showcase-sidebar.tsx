/**
 * UI 展示页组件目录 Sidebar。
 *
 * Sidebar 只负责发出组件选择意图，不拥有右侧预览状态。
 */

import { component_groups } from "../data/component-catalog.js";
import type { ShowcaseSidebarProps } from "../types/components.js";

/** 桌面端固定组件目录。 */
export function ShowcaseSidebar({
  selected_component_id,
  on_select_component,
}: ShowcaseSidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-2 py-3">
        <div className="border-b border-divider px-2 pb-3">
          <p className="text-xs font-medium text-muted-foreground">
            @downcity/ui
          </p>
          <h1 className="mt-1 text-base font-medium text-foreground">Components</h1>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            React + Vite component showcase
          </p>
        </div>

        <nav className="flex flex-col gap-4 py-3" aria-label="组件目录">
          {component_groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="mb-1 px-2 text-[11px] font-medium text-muted-foreground/60">
                {group.label}
              </p>
              {group.items.map((item) => {
                const is_selected = item.id === selected_component_id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={is_selected ? "page" : undefined}
                    onClick={() => on_select_component(item.id)}
                    className="h-8 w-full rounded-lg px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground aria-[current=page]:bg-interaction-selected aria-[current=page]:text-foreground"
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
