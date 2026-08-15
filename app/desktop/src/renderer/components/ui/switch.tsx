/** 基于 Base UI、与 Duobox 一致的二元开关。 */

import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

/** 二元开关属性。 */
export interface SwitchProps extends BaseSwitch.Root.Props {}

/** 提供 Base UI 状态语义和 Duobox 视觉的开关。 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(({ className, ...props }, ref) => (
  <BaseSwitch.Root
    ref={ref}
    className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-start rounded-full border-none p-0.5 transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-muted-foreground/20", className)}
    {...props}
  >
    <BaseSwitch.Thumb className="pointer-events-none block size-4 shrink-0 rounded-full border-none bg-background transition-transform duration-200 data-checked:translate-x-4 data-checked:bg-primary-foreground data-unchecked:translate-x-0" />
  </BaseSwitch.Root>
));
Switch.displayName = "Switch";
