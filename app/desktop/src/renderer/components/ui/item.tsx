/** Duobox 菜单项的统一视觉外壳。 */

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import {
  menu_item_base_class_name,
  menu_item_highlighted_class_name,
  menu_item_interaction_class_name,
} from "./menu-styles";

/** 菜单项视觉外壳属性。 */
interface MenuItemShellProps extends HTMLAttributes<HTMLDivElement> {
  /** 是否显示为当前选中项。 */
  is_selected?: boolean;
  /** 是否增加左侧缩进。 */
  inset?: boolean;
  /** 是否隐藏该项。 */
  hidden?: boolean;
}

/** 为 Base UI 菜单项提供与 Duobox 一致的布局和状态。 */
export const MenuItemShell = forwardRef<HTMLDivElement, MenuItemShellProps>(
  ({ className, is_selected = false, inset, hidden, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        menu_item_base_class_name,
        is_selected ? menu_item_highlighted_class_name : menu_item_interaction_class_name,
        inset && "pl-8",
        hidden && "hidden",
        className,
      )}
      {...props}
    />
  ),
);
MenuItemShell.displayName = "MenuItemShell";
