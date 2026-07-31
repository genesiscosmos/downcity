/**
 * UI 展示页组件目录 Sidebar。
 *
 * Sidebar 只负责发出组件选择意图，不拥有右侧预览状态。
 */

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@downcity/ui";
import { theme_options } from "../lib/theme.js";
import { component_groups } from "../data/component-catalog.js";
import type { ShowcaseColorMode, ShowcaseSidebarProps, ShowcaseThemeId } from "../types/components.js";

/** 主题色板选择器。 */
export function ThemeSelector({ theme_id, on_theme_change, color_mode, on_color_mode_change }: { theme_id: ShowcaseThemeId; on_theme_change: (theme_id: ShowcaseThemeId) => void; color_mode: ShowcaseColorMode; on_color_mode_change: (color_mode: ShowcaseColorMode) => void }) {
  return <div className="mt-3 flex flex-col gap-2"><Select value={theme_id} onValueChange={(value) => { if (theme_options.some((option) => option.id === value)) on_theme_change(value as ShowcaseThemeId); }}><SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Color theme" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Color theme</SelectLabel>{theme_options.map((option) => <SelectItem key={option.id} value={option.id}><span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${option.swatch_class_name}`} />{option.label}</span></SelectItem>)}</SelectGroup></SelectContent></Select><Select value={color_mode} onValueChange={(value) => { if (value === "system" || value === "light" || value === "dark") on_color_mode_change(value); }}><SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Appearance" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Appearance</SelectLabel><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectGroup></SelectContent></Select></div>;
}

/** 桌面端固定组件目录。 */
export function ShowcaseSidebar({
  selected_component_id,
  on_select_component,
  theme_id,
  on_theme_change,
  color_mode,
  on_color_mode_change,
}: ShowcaseSidebarProps) {
  return (
    <aside className="showcase-chrome hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-2 py-3">
        <div className="border-b border-divider px-2 pb-3">
          <p className="text-xs font-medium text-muted-foreground">
            @downcity/ui
          </p>
          <h1 className="mt-1 text-base font-medium text-foreground">Components</h1>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            React + Vite component showcase
          </p>
          <ThemeSelector theme_id={theme_id} on_theme_change={on_theme_change} color_mode={color_mode} on_color_mode_change={on_color_mode_change} />
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
