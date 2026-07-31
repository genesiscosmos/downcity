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
        "inline-flex min-w-36 items-center justify-between gap-1.5 rounded-lg border border-transparent bg-control-surface px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-control-hover focus:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-8 data-[size=sm]:h-6 data-[size=sm]:px-2 data-[size=sm]:text-xs [&_svg]:size-5",
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
  sideOffset = 4,
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
        className="z-50 outline-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "min-w-[var(--anchor-width)] overflow-hidden rounded-xl border border-divider bg-popover text-foreground outline-none data-open:animate-in data-open:fade-in data-open:slide-in-from-top-1 data-closed:animate-out data-closed:fade-out-0 duration-150",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="flex h-7 cursor-default items-center justify-center bg-popover text-muted-foreground [&_svg]:size-4">
            <ChevronUpIcon />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List className="max-h-80 overflow-y-auto p-1">
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
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground/70", className)}
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
        "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-floating-item py-1.5 pr-2 pl-7 text-xs text-foreground outline-none transition-all duration-100 data-highlighted:bg-interaction-hover data-highlighted:text-foreground data-selected:bg-interaction-selected data-selected:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        description && "items-start",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-1.5 flex size-4 items-center justify-center [&_svg]:size-3.5">
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
      <div className="min-w-0 flex-1">
        <SelectPrimitive.ItemText className="block truncate leading-tight">
          {children}
        </SelectPrimitive.ItemText>
        {description ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
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
