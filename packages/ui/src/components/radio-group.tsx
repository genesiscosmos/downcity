"use client";
/** Vibecape 风格 RadioGroup 组件组。 */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as Primitive } from "@base-ui/react/radio-group";
import { cn } from "../lib/utils";
const RadioGroup = Primitive;
const RadioGroupItem = <Value,>({ className, ...props }: Radio.Root.Props<Value>) => <Radio.Root data-slot="radio-group-item" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-control-surface data-checked:border-selection-surface data-checked:bg-selection-surface disabled:opacity-50", className)} {...props}><Radio.Indicator className="size-1.5 rounded-full bg-selection-foreground" /></Radio.Root>;
export { RadioGroup, RadioGroupItem };
