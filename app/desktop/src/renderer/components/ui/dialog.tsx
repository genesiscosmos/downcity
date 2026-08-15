/** 基于 Base UI 的 Desktop 通用 Dialog。 */

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
}

/** 带 Portal、遮罩和标准动效的 Dialog 内容。 */
const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, hide_close = false, ...props }, ref) => <BaseDialog.Portal>
    <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/15 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none transition-[opacity,transform] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
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
  return <div className={cn("px-5 pb-3 pt-5 pr-12", className)} {...props} />;
}

/** Dialog 主体布局。 */
function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-3", className)} {...props} />;
}

/** Dialog 底部操作区。 */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 border-t border-border/60 bg-muted/35 px-5 py-3", className)} {...props} />;
}

export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };
