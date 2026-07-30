"use client";

/**
 * Downcity Slider 滑块组件。
 *
 * 关键说明（中文）
 * - 支持单值与范围值，并由 Base UI 负责拖拽、键盘和表单语义。
 * - 宿主拥有实际数值状态，组件只负责交互和展示。
 */

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "../lib/utils";
import type { DowncitySliderProps } from "../types/components";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: DowncitySliderProps) {
  const resolved_value = value ?? defaultValue ?? min;
  const values = Array.isArray(resolved_value) ? resolved_value : [resolved_value];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full items-center">
        <SliderPrimitive.Track className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/12">
          <SliderPrimitive.Indicator className="rounded-full bg-foreground/85" />
        </SliderPrimitive.Track>
        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            index={index}
            className="size-4 rounded-full border border-border bg-background shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
