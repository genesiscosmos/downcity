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
    <aside className="hidden w-64 shrink-0 border-r border-border-subtle bg-surface-subtle/50 lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-5 py-7">
        <div className="border-b border-divider pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            @downcity/ui
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-[-0.04em]">Components</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            React + Vite component showcase
          </p>
        </div>

        <nav className="flex flex-col gap-6 py-6" aria-label="组件目录">
          {component_groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="mb-1 px-2 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
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
                    className="rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-[current=page]:bg-interaction-selected aria-[current=page]:font-medium aria-[current=page]:text-foreground"
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
