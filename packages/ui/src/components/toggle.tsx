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
import * as React from "react";

import { cn } from "../lib/utils";

const toggleVariants = cva(
  "group/toggle relative inline-flex items-center justify-center rounded-full bg-control-surface p-1 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-pressed:text-foreground data-[state=on]:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "",
        outline: "",
      },
      size: {
        default: "h-9 min-w-9",
        sm: "h-8 min-w-8",
        lg: "h-10 min-w-10 text-sm",
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
  children,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const visible_children = React.Children.toArray(children).filter(Boolean);
  const is_icon_only = visible_children.length === 1 && React.isValidElement(visible_children[0]) && typeof visible_children[0].type !== "string";
  const icon_size_class = size === "sm" ? "size-8" : size === "lg" ? "size-10" : "size-9";
  const content_padding_class = is_icon_only ? "size-full p-0" : size === "sm" ? "h-full px-2" : size === "lg" ? "h-full px-3" : "h-full px-2.5";

  return (
    <TogglePrimitive
      data-slot="toggle"
      data-icon-only={is_icon_only ? "true" : undefined}
      className={cn(toggleVariants({ variant, size }), is_icon_only && icon_size_class, className)}
      {...props}
    >
      <span
        data-slot="toggle-active-layer"
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-full bg-transparent transition-colors group-hover/toggle:bg-interaction-hover group-aria-pressed/toggle:bg-control-hover group-data-[state=on]/toggle:bg-control-hover",
          content_padding_class,
        )}
      >
        {children}
      </span>
    </TogglePrimitive>
  );
}

export { Toggle, toggleVariants };
