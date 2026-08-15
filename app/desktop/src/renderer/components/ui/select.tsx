/** 基于 Base UI、与 Duobox 一致的表单选择器。 */

import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { TbCheck, TbChevronDown } from "react-icons/tb";
import { cn } from "@/lib/utils";

/** Select 简化选项。 */
export interface SelectOption {
  /** 选项稳定值。 */
  value: string;
  /** 选项展示名称。 */
  label: string;
  /** 是否禁止选择。 */
  disabled?: boolean;
}

/** Select 根组件属性。 */
interface SelectProps extends Omit<BaseSelect.Root.Props<string>, "items" | "onValueChange"> {
  /** 当前选中值。 */
  value: string;
  /** 全部可选项。 */
  options: SelectOption[];
  /** 值变化回调。 */
  on_value_change(value: string): void;
  /** 触发器附加样式。 */
  className?: string;
  /** 菜单对齐方向。 */
  align?: "start" | "center" | "end";
}

/** 具有原生 Select 语义、键盘导航和碰撞定位的选择器。 */
export function Select({ value, options, on_value_change, className, align = "start", ...props }: SelectProps) {
  const current_label = options.find((option) => option.value === value)?.label ?? "";
  return (
    <BaseSelect.Root items={options} value={value} onValueChange={(next_value) => next_value !== null && on_value_change(next_value)} {...props}>
      <BaseSelect.Trigger
        className={cn(
          "group/select inline-flex h-8 min-w-36 items-center justify-between gap-2 rounded-lg bg-control-surface px-2.5 text-xs text-foreground/75 outline-none transition-colors hover:bg-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-[popup-open]:bg-interaction-selected data-[popup-open]:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className="min-w-0 truncate">{current_label}</span>
        <BaseSelect.Icon><TbChevronDown className="size-3.5 opacity-45 transition-transform group-data-[popup-open]/select:rotate-180" /></BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} align={align} alignItemWithTrigger={false} className="z-[9999] outline-none">
          <BaseSelect.Popup className="relative w-max min-w-[var(--anchor-width)] max-w-[min(20rem,var(--available-width))] overflow-hidden rounded-floating-surface border border-border bg-background text-foreground outline-none data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in data-[open]:slide-in-from-top-1 duration-150">
            <div className="max-h-[min(20rem,var(--available-height))] overflow-y-auto p-1 scrollbar-none">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="relative flex w-full cursor-default select-none items-center gap-2.5 rounded-floating-item py-1.5 pr-2 pl-7 text-xs text-foreground/80 outline-none transition-colors duration-100 hover:bg-interaction-hover hover:text-foreground data-[highlighted]:bg-interaction-hover data-[highlighted]:text-foreground data-[selected]:bg-interaction-selected data-[selected]:text-foreground data-[selected]:hover:bg-interaction-active data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <BaseSelect.ItemIndicator className="absolute left-1.5 flex size-4 items-center justify-center text-foreground/75"><TbCheck className="size-3.5" /></BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </div>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
