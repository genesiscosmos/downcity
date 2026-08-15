/** Duobox 浮层菜单表面组件。 */

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { menu_surface_class_name, menu_surface_motion_class_name } from "./menu-styles";

/** 菜单表面属性。 */
interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** 是否启用 Duobox 的开合动画。 */
  motion?: boolean;
}

/** 统一菜单浮层的边框、圆角、背景和动画。 */
export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(
  ({ className, motion = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(menu_surface_class_name, motion && menu_surface_motion_class_name, className)}
      {...props}
    />
  ),
);
MenuSurface.displayName = "MenuSurface";
