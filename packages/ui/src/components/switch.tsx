"use client";

/**
 * Downcity Switch 开关组件。
 *
 * 关键说明（中文）
 * - 用于开关单个布尔配置，不承担业务状态持久化。
 * - 基于 Base UI 保留受控、非受控、表单和键盘访问能力。
 */

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-start rounded-full border-none p-0.5 transition-colors data-checked:bg-primary data-unchecked:bg-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 shrink-0 rounded-full border-none bg-background transition-transform duration-200 data-checked:bg-primary-foreground data-checked:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
