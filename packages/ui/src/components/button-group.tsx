/**
 * Downcity ButtonGroup 按钮组合容器。
 *
 * 关键说明（中文）
 * - 只负责相邻按钮的布局、边界合并与首尾圆角，不改变 Button 的视觉语义。
 * - 支持横向与纵向组合，Button 在组合外仍保持完全独立。
 */

import type * as React from "react";

import { cn } from "../lib/utils";
import type { DowncityButtonGroupProps } from "../types/components";

function ButtonGroup({
  className,
  orientation = "horizontal",
  ...props
}: DowncityButtonGroupProps) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(
        "group/button-group flex w-fit items-stretch [&>[data-slot=button]]:relative [&>[data-slot=button]]:rounded-none [&>[data-slot=button]]:focus-visible:z-10",
        orientation === "horizontal"
          ? "flex-row [&>[data-slot=button]+[data-slot=button]]:-ml-px [&>[data-slot=button]:first-child]:rounded-l-md [&>[data-slot=button]:last-child]:rounded-r-md"
          : "flex-col [&>[data-slot=button]+[data-slot=button]]:-mt-px [&>[data-slot=button]:first-child]:rounded-t-md [&>[data-slot=button]:last-child]:rounded-b-md",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
