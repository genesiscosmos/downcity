"use client";

/**
 * Downcity Select 选择器组件组。
 *
 * 关键说明（中文）
 * - 基于 Base UI 提供受控、非受控、键盘导航与表单能力。
 * - 选项必须放在 SelectGroup 中，保持分组语义和组合结构稳定。
 */

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "../lib/utils";
import type {
  DowncitySelectContentProps,
  DowncitySelectItemProps,
  DowncitySelectTriggerProps,
} from "../types/components";

const Select = SelectPrimitive.Root;

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  size = "default",
  ...props
}: DowncitySelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "inline-flex min-w-36 items-center justify-between gap-2 rounded-[12px] bg-control-surface px-3 text-sm text-foreground outline-none transition-colors hover:bg-control-hover focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:px-2.5 data-[size=sm]:text-xs [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <ChevronDownIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: DowncitySelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        alignItemWithTrigger={false}
        className="isolate outline-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-[18px] border border-border/70 bg-popover/98 text-popover-foreground shadow-[0_10px_24px_rgba(24,24,27,0.045)] outline-none backdrop-blur-xl data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-95 data-starting-style:scale-95",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="flex h-7 cursor-default items-center justify-center bg-popover text-muted-foreground [&_svg]:size-4">
            <ChevronUpIcon />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List className="max-h-80 overflow-y-auto p-1.5">
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className="flex h-7 cursor-default items-center justify-center bg-popover text-muted-foreground [&_svg]:size-4">
            <ChevronDownIcon />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-2 text-[11px] font-medium text-muted-foreground/70", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  description,
  ...props
}: DowncitySelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-9 w-full cursor-default select-none items-center gap-2 rounded-[12px] py-2 pr-2 pl-8 text-sm text-foreground/85 outline-none transition-colors data-highlighted:bg-interaction-hover data-selected:bg-interaction-selected data-disabled:pointer-events-none data-disabled:opacity-50",
        description && "items-start",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center [&_svg]:size-3.5">
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
      <div className="min-w-0 flex-1">
        <SelectPrimitive.ItemText className="block truncate leading-5">
          {children}
        </SelectPrimitive.ItemText>
        {description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-divider", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
