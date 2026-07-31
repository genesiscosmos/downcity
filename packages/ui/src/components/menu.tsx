/**
 * Downcity Menu 纯展示基础原语。
 *
 * 关键说明（中文）
 * - 复用 Vibecape 的菜单 surface、分组、空态与加载态。
 * - 不替代 Base UI DropdownMenu 或 ContextMenu 的焦点管理。
 */

import type * as React from "react";

import { cn } from "../lib/utils";

function MenuSurface({ className, children, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-48 overflow-hidden rounded-xl border border-divider bg-popover p-1 text-popover-foreground outline-none", className)} {...props}>{children}</div>;
}

function MenuGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

function MenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-2 py-2 text-[11px] font-medium text-muted-foreground/60 select-none", className)} {...props} />;
}

function MenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="separator" className={cn("-mx-1 my-1 h-px bg-divider", className)} {...props} />;
}

function MenuEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-3 py-6 text-center text-sm text-muted-foreground", className)} {...props} />;
}

export { MenuEmpty, MenuGroup, MenuLabel, MenuSeparator, MenuSurface };
