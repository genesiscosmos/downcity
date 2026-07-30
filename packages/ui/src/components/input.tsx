/**
 * Downcity Input 基础组件。
 *
 * 关键说明（中文）
 * - 用于单行文本、搜索、参数等输入场景。
 * - 保持与 Console 一致的轻量背景、聚焦态与错误态反馈。
 */

import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-lg border border-transparent bg-control-surface p-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/50 hover:bg-control-hover focus:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
