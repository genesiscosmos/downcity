"use client";

/**
 * Downcity Toggle 基础组件。
 *
 * 关键说明（中文）
 * - 用于单个开关按钮或富交互工具栏按钮。
 * - 支持 `default` 与 `outline` 两种视觉风格，以及多尺寸。
 */

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-md text-xs whitespace-nowrap transition-colors outline-none hover:bg-interaction-hover hover:text-foreground aria-pressed:bg-interaction-selected data-[state=on]:bg-interaction-selected disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "bg-control-surface hover:bg-control-hover",
      },
      size: {
        default: "h-6 min-w-6 px-1.5",
        sm: "h-6 min-w-6 px-1.5 text-xs",
        lg: "h-8 min-w-8 px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
