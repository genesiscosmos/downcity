/** Duobox 浮层菜单表面组件。 */

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { menu_scroll_class_name, menu_surface_class_name, menu_surface_motion_class_name } from "./menu-styles";

/** 菜单表面属性。 */
interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** 是否启用 Duobox 的开合动画。 */
  motion?: boolean;
  /**
   * 内容滚动区的高度上限等样式；不传时用共享默认值（视口可用高度与 20rem 取小）。
   *
   * 宽度、最小宽度这类属于**浮层本身**的样式仍写在 `className` 上；只有高度上限与滚动
   * 相关的样式属于滚动区——它们分处两层，混在一起会让滚动条回到圆角表面上。
   */
  scroll_class_name?: string;
}

/**
 * 统一菜单浮层的边框、圆角、背景和动画。
 *
 * 表面与滚动区分成两层（结构原因见 menu-styles 的 `menu_scroll_class_name`）：
 * 圆角只对外层生效，滚动条因此被裁剪在圆角内，不会戳出角落。
 *
 * 内层带 `role="presentation"`：`role="menu"` 的直接子元素只应是 menuitem / group / separator，
 * 这个纯布局容器必须对辅助技术隐藏，否则读屏会把「分组」当成菜单项。
 */
export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(
  ({ className, motion = true, scroll_class_name, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(menu_surface_class_name, motion && menu_surface_motion_class_name, className)}
      {...props}
    >
      <div role="presentation" className={cn(menu_scroll_class_name, scroll_class_name)}>{children}</div>
    </div>
  ),
);
MenuSurface.displayName = "MenuSurface";
