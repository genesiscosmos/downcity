/** 设置页使用的原生可访问滑块。 */

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** 数值滑块属性。 */
interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  /** 当前数值。 */
  value: number;
  /** 最小值。 */
  min: number;
  /** 最大值。 */
  max: number;
  /** 数值步长。 */
  step: number;
  /** 数值变化回调。 */
  on_value_change(value: number): void;
}

/** 与 Duobox 外观设置一致的紧凑滑块。 */
export function Slider({ value, min, max, step, on_value_change, className, ...props }: SliderProps) {
  const progress = max === min ? 0 : (value - min) / (max - min) * 100;
  return <div className={cn("relative h-5 w-48", className)}>
    <span className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted-foreground/15">
      <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/85" style={{ width: `${progress}%` }} />
    </span>
    <input {...props} type="range" min={min} max={max} step={step} value={value} onChange={(event) => on_value_change(Number(event.target.value))} className="absolute inset-0 h-5 w-full cursor-pointer opacity-0" />
  </div>;
}
