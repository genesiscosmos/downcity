/**
 * Downcity Item 通用内容项组合组件。
 *
 * 关键说明（中文）
 * - 用于搜索结果、资源列表、设置入口和选择候选项等重复布局。
 * - 组件只定义内容层级，不包含菜单、路由或业务选择状态。
 */

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import type {
  DowncityItemMediaVariant,
  DowncityItemSize,
  DowncityItemVariant,
} from "../types/components";
import { cn } from "../lib/utils";

const item_variants = cva(
  "group/item flex min-w-0 items-center gap-3 rounded-xl text-left outline-none transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/30",
  {
    variants: {
      variant: {
        default: "hover:bg-interaction-hover",
        outline: "border border-border-subtle bg-card hover:bg-interaction-hover",
        muted: "bg-surface-subtle hover:bg-interaction-hover",
      } satisfies Record<DowncityItemVariant, string>,
      size: {
        default: "min-h-14 px-3.5 py-3",
        sm: "min-h-10 px-3 py-2",
      } satisfies Record<DowncityItemSize, string>,
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Item({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof item_variants>) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(item_variants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "item",
      variant,
      size,
    },
  });
}

const item_media_variant_class_names: Record<DowncityItemMediaVariant, string> = {
  default: "text-muted-foreground [&_svg]:size-4",
  icon: "size-9 rounded-lg border border-border-subtle bg-control-surface text-muted-foreground [&_svg]:size-4",
  image: "size-10 overflow-hidden rounded-lg [&_img]:size-full [&_img]:object-cover",
};

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: DowncityItemMediaVariant;
}) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(
        "flex shrink-0 items-center justify-center",
        item_media_variant_class_names[variant],
        className,
      )}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("truncate text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn("line-clamp-2 text-xs leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex shrink-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-group"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  item_variants,
};
