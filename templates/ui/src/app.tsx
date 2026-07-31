/**
 * Downcity UI 组件展示应用入口。
 *
 * 页面采用左侧组件目录与右侧单组件预览结构，选择状态由 App 统一拥有，
 * Sidebar、移动端选择器和预览区域只消费最小必要状态。
 */

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Toaster,
  TooltipProvider,
  ThemeContainer,
} from "@downcity/ui";

import { MarkdownDocument } from "./components/markdown-document.js";
import { ShowcaseSidebar, ThemeSelector } from "./components/showcase-sidebar.js";
import {
  component_groups,
  is_showcase_component_id,
} from "./data/component-catalog.js";
import type { ShowcaseComponentId } from "./types/components.js";
import { mdx_document_registry } from "./mdx/registry.js";
import { use_theme } from "./lib/theme.js";

const default_component_id: ShowcaseComponentId = "button";

/** 从当前 URL hash 读取有效的组件标识。 */
function read_component_from_hash(): ShowcaseComponentId {
  if (typeof window === "undefined") return default_component_id;
  const hash_value = window.location.hash.replace(/^#/, "");
  return is_showcase_component_id(hash_value) ? hash_value : default_component_id;
}

/** UI SDK 独立展示应用。 */
export function App() {
  const { theme_id, set_theme_id, color_mode, set_color_mode, resolved_color_mode } = use_theme();
  const [selected_component_id, set_selected_component_id] =
    useState<ShowcaseComponentId>(read_component_from_hash);

  useEffect(() => {
    const sync_component_from_hash = () => {
      set_selected_component_id(read_component_from_hash());
    };

    window.addEventListener("hashchange", sync_component_from_hash);
    return () => window.removeEventListener("hashchange", sync_component_from_hash);
  }, []);

  /** 同步选择状态与可分享的 URL hash。 */
  const select_component = (component_id: ShowcaseComponentId) => {
    set_selected_component_id(component_id);
    window.history.replaceState(null, "", `#${component_id}`);
  };

  return (
    <TooltipProvider>
      <div className="showcase-page min-h-screen lg:flex lg:h-screen lg:overflow-hidden">
        <ShowcaseSidebar
          selected_component_id={selected_component_id}
          on_select_component={select_component}
          theme_id={theme_id}
          on_theme_change={set_theme_id}
          color_mode={color_mode}
          on_color_mode_change={set_color_mode}
        />

        <div className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
          <header className="showcase-chrome sticky top-0 z-30 border-b border-border bg-background px-4 py-3 lg:hidden">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">
                  @downcity/ui
                </p>
                <p className="mt-1 truncate text-xs text-foreground">Component showcase</p>
              </div>
              <Select
                value={selected_component_id}
                onValueChange={(value) => {
                  if (value && is_showcase_component_id(value)) select_component(value);
                }}
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder="Select component" />
                </SelectTrigger>
                <SelectContent>
                  {component_groups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ThemeSelector theme_id={theme_id} on_theme_change={set_theme_id} color_mode={color_mode} on_color_mode_change={set_color_mode} />
          </header>

          <main className="min-h-full">
            <ThemeContainer variant={theme_id} mode={resolved_color_mode} className="min-h-full">
              <MarkdownDocument document={mdx_document_registry[selected_component_id]} />
            </ThemeContainer>
          </main>
        </div>

        <Toaster theme={resolved_color_mode} />
      </div>
    </TooltipProvider>
  );
}
