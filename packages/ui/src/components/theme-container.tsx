"use client";

/**
 * Downcity UI 主题容器。
 *
 * 关键说明（中文）
 * - 一个容器统一拥有整棵组件树的主题 variant 与明暗 mode。
 * - Portal 自动挂载到主题容器内部，浮层无需单独同步主题。
 */

import { createContext, useContext, useMemo, useRef } from "react";

import type {
  DowncityThemeContainerProps,
  DowncityThemeContextValue,
} from "../types/components";
import { cn } from "../lib/utils";

const theme_context = createContext<DowncityThemeContextValue | null>(null);

/** 返回当前主题容器拥有的 Portal 挂载节点。 */
function use_theme_portal_container() {
  return useContext(theme_context)?.portal_container;
}

/** 为整棵组件树提供唯一主题。 */
function ThemeContainer({
  children,
  className,
  mode = "light",
  variant = "neutral",
  ...props
}: DowncityThemeContainerProps) {
  const portal_container = useRef<HTMLDivElement>(null);
  const theme_value = useMemo(() => ({ portal_container }), []);

  return (
    <theme_context.Provider value={theme_value}>
      <div
        data-slot="theme-container"
        data-ui-theme={variant}
        data-ui-mode={mode}
        className={cn("dc-theme-container", mode === "dark" && "dark", className)}
        {...props}
      >
        {children}
        <div
          ref={portal_container}
          data-slot="theme-portal-container"
          className="contents"
        />
      </div>
    </theme_context.Provider>
  );
}

export { ThemeContainer, use_theme_portal_container };
