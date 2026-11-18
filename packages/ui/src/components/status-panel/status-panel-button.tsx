/**
 * StatusPanel 与独立交互表单共用的紧凑按钮。
 * 几何、主色、展开和键盘焦点状态在此集中声明，业务组件只选择语义规格；
 * 公共 Button 继续负责 Base UI 交互与属性透传，面板不依赖宿主的按钮 CSS。
 */
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";
import type { StatusPanelButtonProps } from "../../types/status-panel-button";
import { Button } from "../button";

const status_panel_button_variants = cva(
  "rounded-control border-none bg-transparent text-muted-foreground hover:bg-interaction-hover hover:text-foreground data-[popup-open]:bg-interaction-selected data-[popup-open]:text-foreground data-[popup-open]:hover:bg-interaction-active data-[state=open]:bg-interaction-selected data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
  {
    variants: {
      variant: {
        default: "",
        primary: "bg-primary/90 text-primary-foreground/80 hover:bg-primary hover:text-primary-foreground data-[popup-open]:bg-primary data-[popup-open]:text-primary-foreground data-[popup-open]:hover:bg-primary data-[state=open]:bg-primary data-[state=open]:text-primary-foreground [&_svg]:text-primary-foreground",
      },
      size: {
        compact: "h-6 w-auto min-w-0 gap-1 px-1.5 text-2xs leading-4 [&_svg]:size-3.5",
        icon: "size-6 shrink-0 p-0 [&_svg]:size-3.5",
        "inline-icon": "size-5 shrink-0 rounded-chip p-0 [&_svg]:size-3",
        "chat-action": "h-7 w-auto min-w-0 gap-1 rounded-full px-3 text-2xs leading-4 [&_svg]:size-3.5",
        action: "h-8 w-auto min-w-0 gap-1.5 px-3 text-xs leading-4 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "compact" },
  },
);

/** 显式选择基础尺寸，避免图标推断或加载中图标改变按钮布局。 */
export function StatusPanelButton({ className, variant, size, ...props }: StatusPanelButtonProps) {
  return <Button variant="ghost" size="default" className={cn(status_panel_button_variants({ variant, size }), className)} {...props} />;
}
