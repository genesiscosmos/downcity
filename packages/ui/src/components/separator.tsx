/**
 * Downcity Separator 基础组件。
 *
 * 关键说明（中文）
 * - 用于卡片、菜单、表单分组之间的轻量分隔。
 * - 通过 `orientation` 支持横向与纵向两种布局语义。
 */

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "../lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-divider data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
