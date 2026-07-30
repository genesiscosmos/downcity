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
} from "@downcity/ui";

import { MarkdownDocument } from "./components/markdown-document.js";
import { ShowcaseSidebar } from "./components/showcase-sidebar.js";
import {
  component_groups,
  is_showcase_component_id,
} from "./data/component-catalog.js";
import type { ShowcaseComponentId } from "./types/components.js";
import { mdx_document_registry } from "./mdx/registry.js";

const default_component_id: ShowcaseComponentId = "button";

/** 从当前 URL hash 读取有效的组件标识。 */
function read_component_from_hash(): ShowcaseComponentId {
  if (typeof window === "undefined") return default_component_id;
  const hash_value = window.location.hash.replace(/^#/, "");
  return is_showcase_component_id(hash_value) ? hash_value : default_component_id;
}

/** UI SDK 独立展示应用。 */
export function App() {
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
      <div className="min-h-screen bg-background text-foreground lg:flex lg:h-screen lg:overflow-hidden">
        <ShowcaseSidebar
          selected_component_id={selected_component_id}
          on_select_component={select_component}
        />

        <div className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
          <header className="sticky top-0 z-30 border-b border-border-subtle bg-background/90 px-5 py-4 backdrop-blur-xl sm:px-8 lg:hidden">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  @downcity/ui
                </p>
                <p className="mt-1 truncate text-sm font-medium">Component showcase</p>
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
          </header>

          <main>
            <MarkdownDocument document={mdx_document_registry[selected_component_id]} />
          </main>
        </div>

        <Toaster theme="light" />
      </div>
    </TooltipProvider>
  );
}
