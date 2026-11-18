/** 富文本输入专用紧凑控件：尺寸、操作状态与菜单几何不随全局 Button/Dropdown 默认值变化。 */
import { forwardRef } from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "../../lib/utils";
import type { ChatInputButtonProps } from "../../types/chat-input";

/** Slash 与附件菜单共同使用的行布局；键盘选中与普通悬停分开表达。 */
export const input_menu_item_class_name = "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-xs text-foreground outline-none transition-all duration-100 [&>svg]:size-3.5 [&>svg]:shrink-0";
export const input_menu_item_interaction_class_name = "hover:bg-interaction-hover hover:text-foreground data-highlighted:bg-interaction-hover data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50";
export const input_menu_item_selected_class_name = "bg-interaction-selected text-foreground hover:bg-interaction-active focus:bg-interaction-active";

/** 输入栏按钮固定为 24px；主操作颜色来自宿主语义令牌，保留原生按钮的焦点与禁用行为。 */
export const InputButton = forwardRef<HTMLButtonElement, ChatInputButtonProps>(function InputButton({ className, variant = "default", size = "default", type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn(
    "inline-flex flex-none items-center justify-center whitespace-nowrap rounded-control border-none bg-transparent text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-selected data-[popup-open]:text-foreground data-[popup-open]:hover:bg-interaction-active focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    size === "icon" ? "size-6 shrink-0 p-0 [&_svg]:size-3.5" : "h-6 w-auto min-w-0 gap-1 px-1.5 text-2xs leading-4 [&_svg]:size-3.5",
    variant === "primary" && "bg-primary/90 text-primary-foreground/80 hover:bg-primary hover:text-primary-foreground data-[popup-open]:bg-primary data-[popup-open]:text-primary-foreground [&_svg]:text-primary-foreground",
    className,
  )} {...props} />;
});

export const InputMenu = Menu.Root;
export const InputMenuTrigger = Menu.Trigger;

/** 附件菜单采用 13rem 最小宽度；裁剪表面与滚动内容分层，避免滚动条穿出圆角。 */
export function InputMenuContent({ children }: Pick<Menu.Popup.Props, "children">) {
  return <Menu.Portal><Menu.Positioner side="top" sideOffset={4} align="start" className="z-50 outline-none">
    <Menu.Popup className="chat-input-menu-surface z-50 min-w-52 overflow-hidden rounded-surface border border-border text-popover-foreground outline-none data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-[side=top]:slide-in-from-bottom-1 duration-150">
      <div role="presentation" className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain p-1">{children}</div>
    </Menu.Popup>
  </Menu.Positioner></Menu.Portal>;
}

/** Base UI 统一处理焦点、鼠标与键盘导航；行样式只属于输入菜单。 */
export function InputMenuItem({ className, ...props }: Menu.Item.Props) {
  return <Menu.Item className={cn(input_menu_item_class_name, input_menu_item_interaction_class_name, typeof className === "string" ? className : undefined)} {...props} />;
}
