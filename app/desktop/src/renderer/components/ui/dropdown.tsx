/** 基于 Base UI、与 Duobox 一致的操作菜单。 */

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { TbCheck } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { MenuItemShell } from "./item";
import { MenuSurface } from "./menu";
import { menu_label_class_name, menu_separator_class_name, menu_shortcut_class_name } from "./menu-styles";

const DropdownMenu = Menu.Root;

/** 下拉菜单触发器属性。 */
interface DropdownMenuTriggerProps extends Menu.Trigger.Props {
  /** 是否直接复用唯一子元素。 */
  asChild?: boolean;
}

/** 兼容 Duobox asChild 调用方式的触发器。 */
const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ asChild, children, nativeButton, ...props }, ref) => asChild && React.isValidElement(children)
    ? <Menu.Trigger ref={ref} render={children} nativeButton={nativeButton ?? true} {...props} />
    : <Menu.Trigger ref={ref} nativeButton={nativeButton} {...props}>{children}</Menu.Trigger>,
);
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

/** 下拉菜单浮层属性。 */
interface DropdownMenuContentProps extends Omit<Menu.Popup.Props, "className" | "render"> {
  /** 浮层自身样式（宽度、最小宽度等）。**不要**在这里写高度上限或 overflow。 */
  className?: string;
  /**
   * 内容滚动区样式；不传时用共享默认值：视口可用高度与 20rem 取小。
   *
   * 高度上限必须写在这里而不是 `className`：滚动区在内层，圆角只对外层生效，
   * 写错那层会让滚动条戳出圆角（原因见 menu-styles）。
   */
  scroll_class_name?: string;
  /** 与触发器的间距。 */
  sideOffset?: number;
  /** 水平对齐方向。 */
  align?: "start" | "center" | "end";
  /** 展开方向。 */
  side?: "top" | "right" | "bottom" | "left";
}

/** 带 Portal 和碰撞定位的下拉菜单浮层。 */
const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, scroll_class_name, sideOffset = 4, align = "start", side = "bottom", ...props }, ref) => (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset} align={align} side={side} className="z-50 outline-none">
        <Menu.Popup ref={ref} render={<MenuSurface className={className} scroll_class_name={scroll_class_name} />} {...props} />
      </Menu.Positioner>
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = "DropdownMenuContent";

/** 下拉菜单项属性。 */
interface DropdownMenuItemProps extends Omit<Menu.Item.Props, "className" | "render"> {
  /** 附加样式。 */
  className?: string;
  /** 是否显示为选中项。 */
  is_selected?: boolean;
  /** 是否增加左侧缩进。 */
  inset?: boolean;
}

/** 具有完整键盘导航和选中态的菜单项。 */
const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, is_selected, inset, ...props }, ref) => (
    <Menu.Item
      ref={ref}
      render={<MenuItemShell className={className} is_selected={is_selected} inset={inset} />}
      {...props}
    />
  ),
);
DropdownMenuItem.displayName = "DropdownMenuItem";

/** 下拉菜单开关项属性。 */
interface DropdownMenuCheckboxItemProps extends Omit<Menu.CheckboxItem.Props, "className" | "render"> {
  /** 附加样式。 */
  className?: string;
}

/**
 * 菜单里的开关项：勾选态由前导对勾表达，不叠选中底色。
 *
 * 四点都不能省：
 *
 * 1. **对勾位固定占宽**（`keepMounted` + 未勾选时透明）。Base UI 默认在未勾选时卸载
 *    指示器，那样这一项的文字会左移，与相邻带图标的项错开。
 * 2. **不额外给图标**：对勾占的就是相邻项图标那一个前导位（与 macOS 菜单同做法），
 *    再加一个图标就变成两个前导符，而两者说的是同一件事。
 * 3. **不传 `is_selected`**：勾选态已经有对勾这一个信号，再加底色等于同一件事说两遍，
 *    而且会与「当前所在项」那类真正的选中态混淆。
 * 4. **`closeOnClick` 沿用 Base UI 默认的 false**：开关是「就地改设置」，关掉菜单会让
 *    用户无法接着执行同一组里的动作（例如切到源码模式后立刻复制全文）。
 */
const DropdownMenuCheckboxItem = React.forwardRef<HTMLDivElement, DropdownMenuCheckboxItemProps>(
  ({ className, children, ...props }, ref) => (
    <Menu.CheckboxItem ref={ref} render={<MenuItemShell className={className} />} {...props}>
      <Menu.CheckboxItemIndicator keepMounted className="flex size-3.5 shrink-0 items-center justify-center data-[unchecked]:opacity-0">
        <TbCheck className="size-3.5" aria-hidden />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  ),
);
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

const DropdownMenuGroup = Menu.Group;
const DropdownMenuLabel = React.forwardRef<HTMLDivElement, Menu.GroupLabel.Props>(({ className, ...props }, ref) => <Menu.GroupLabel ref={ref} className={cn(menu_label_class_name, className)} {...props} />);
DropdownMenuLabel.displayName = "DropdownMenuLabel";
const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, Menu.Separator.Props>(({ className, ...props }, ref) => <Menu.Separator ref={ref} className={cn(menu_separator_class_name, className)} {...props} />);
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn(menu_shortcut_class_name, className)} {...props} />;

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
};
