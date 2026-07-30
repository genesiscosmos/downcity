/**
 * Downcity Kbd 键盘按键提示组件。
 *
 * 关键说明（中文）
 * - 用于展示快捷键或单个键位，不负责监听键盘事件。
 * - 使用语义化 `kbd` 元素，适用于菜单、命令面板与帮助文本。
 */

import type * as React from "react";

import { cn } from "../lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex min-h-5 min-w-5 items-center justify-center rounded-md border border-border-subtle bg-control-surface px-1.5 font-sans text-[0.65rem] font-medium leading-none text-muted-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] select-none",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
