/**
 * Downcity Badge 基础组件。
 *
 * 关键说明（中文）
 * - 用于状态、分类、标签等轻量信息承载。
 * - 语义颜色、尺寸、字重和文字省略统一在 SDK 内定义，宿主仅负责标签组布局。
 * - 高度由行高和上下留白自然撑开；仅正文标签负责横向省略，避免压缩和裁切字形。
 */

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { Children } from "react";
import type { BadgeProps } from "../types/badge";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-auto w-fit min-w-0 max-w-full shrink-0 items-center justify-center gap-1 rounded-full border-0 font-normal whitespace-nowrap align-middle transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:text-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "bg-surface-emphasis text-foreground/80 [a]:hover:bg-interaction-selected",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",
        outline:
          "bg-transparent text-foreground inset-ring inset-ring-border-subtle [a]:hover:bg-surface-subtle",
        ghost: "hover:bg-interaction-hover hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "min-h-5 px-2 py-0.5 text-[11px] leading-4",
        default: "min-h-6 px-2.5 py-0.5 text-xs leading-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size = "default",
  children,
  title,
  render,
  ...props
}: BadgeProps) {
  // 原生文字有独立行盒，只在宽度不足时省略；图标及调用方自定义节点保留组合结构。
  const content = Children.map(children, (child) => typeof child === "string" || typeof child === "number"
    ? <span data-slot="badge-label" className="min-w-0 truncate leading-[inherit]">{child}</span>
    : child);
  const full_text = Children.toArray(children)
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("") || undefined;
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
        children: content,
        title: title ?? full_text,
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      size,
    },
  });
}

export { Badge, badgeVariants };
