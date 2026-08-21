/** 基于 Base UI、与 Duobox Dialog 视觉和交互规范一致的 Desktop 通用 Dialog。 */

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const Dialog = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;
const DialogClose = BaseDialog.Close;

/** Dialog 内容属性。 */
interface DialogContentProps extends BaseDialog.Popup.Props {
  /** Dialog 内容。 */
  children: React.ReactNode;
  /** 是否隐藏右上角关闭按钮。 */
  hide_close?: boolean;
  /** Dialog 宽度规格。 */
  size?: DialogSize;
}

/** Dialog 支持的内容宽度规格。 */
type DialogSize = "sm" | "md" | "lg" | "fullscreen";

const dialog_size_class_names: Record<DialogSize, string> = {
  sm: "w-[min(25rem,calc(100vw-2rem))]",
  md: "w-[min(32rem,calc(100vw-2rem))]",
  lg: "w-[min(48rem,calc(100vw-2rem))]",
  fullscreen: "h-[min(52rem,calc(100vh-2rem))] w-[min(72rem,calc(100vw-2rem))]",
};

/** 带 Portal、遮罩和标准动效的 Dialog 内容。 */
const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, hide_close = false, size = "md", ...props }, ref) => <BaseDialog.Portal>
    <BaseDialog.Backdrop className="desktop-dialog-backdrop fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        "desktop-dialog-popup fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-background text-foreground shadow-2xl outline-none",
        dialog_size_class_names[size],
        className,
      )}
      {...props}
    >
      {children}
      {!hide_close ? <BaseDialog.Close render={<Button size="icon" className="absolute right-3 top-3" aria-label="关闭"><TbX /></Button>} /> : null}
    </BaseDialog.Popup>
  </BaseDialog.Portal>,
);
DialogContent.displayName = "DialogContent";

/** Dialog 标题。 */
const DialogTitle = React.forwardRef<HTMLHeadingElement, BaseDialog.Title.Props>(({ className, ...props }, ref) => <BaseDialog.Title ref={ref} className={cn("text-sm font-semibold text-foreground", className)} {...props} />);
DialogTitle.displayName = "DialogTitle";

/** Dialog 说明。 */
const DialogDescription = React.forwardRef<HTMLParagraphElement, BaseDialog.Description.Props>(({ className, ...props }, ref) => <BaseDialog.Description ref={ref} className={cn("mt-1 text-[0.6875rem] leading-4 text-muted-foreground", className)} {...props} />);
DialogDescription.displayName = "DialogDescription";

/** Dialog 头部布局。 */
function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-start gap-3 px-4 pb-3 pt-4 pr-12", className)} {...props} />;
}

/** Dialog 主体布局。 */
function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex flex-1 flex-col overflow-y-auto px-4 pb-4", className)} {...props} />;
}

/** Dialog 底部操作区。 */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-center justify-end gap-2 bg-foreground/[0.015] px-4 py-3 [&_button]:h-8 [&_button]:px-3 [&_button]:text-xs", className)} {...props} />;
}

export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };
