/** 基于 Base UI、与 Duobox 一致的通用 Popover。 */

import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

const Popover = BasePopover.Root;

/** Popover 触发器属性。 */
interface PopoverTriggerProps extends BasePopover.Trigger.Props {
  /** 是否直接复用唯一子元素。 */
  asChild?: boolean;
}

/** 兼容 Duobox asChild 调用方式的触发器。 */
const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ asChild, children, nativeButton, ...props }, ref) => asChild && React.isValidElement(children)
    ? <BasePopover.Trigger ref={ref} render={children} nativeButton={nativeButton ?? true} {...props} />
    : <BasePopover.Trigger ref={ref} nativeButton={nativeButton} {...props}>{children}</BasePopover.Trigger>,
);
PopoverTrigger.displayName = "PopoverTrigger";

/** Popover 浮层属性。 */
interface PopoverContentProps extends BasePopover.Popup.Props {
  /** 对齐方向。 */
  align?: "start" | "center" | "end";
  /** 与触发器的间距。 */
  sideOffset?: number;
  /** 展开方向。 */
  side?: "top" | "right" | "bottom" | "left";
}

/** 带 Portal、碰撞定位和 Duobox 动画的 Popover 内容。 */
const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, align = "center", sideOffset = 4, side = "bottom", ...props }, ref) => (
    <BasePopover.Portal>
      <BasePopover.Positioner sideOffset={sideOffset} side={side} align={align} className="z-50 outline-none">
        <BasePopover.Popup
          ref={ref}
          className={cn(
            "z-50 w-72 overflow-hidden rounded-floating-surface border border-border bg-background text-popover-foreground outline-none [&>div]:p-1",
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 duration-150",
            className,
          )}
          {...props}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  ),
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverContent, PopoverTrigger };
