/**
 * Desktop 通用 Dialog 原语。
 *
 * 全应用只有这一份 Dialog 实现：遮罩、圆角、动效、关闭按钮与三段布局都由这里决定，
 * 调用点只负责内容与文案。这样「每个弹窗看起来是同一套东西」由结构保证，
 * 而不是靠每个调用点各自对齐样式。
 *
 * 三段布局的职责：
 *
 * - `DialogHeader`：可选的图标徽章 + 标题 + 说明。徽章的尺寸、圆角与底色由原语拥有，
 *   调用点只传图形与色调，不再自己拼装；标题区始终包一层 `min-w-0 flex-1`，
 *   长文案才会正确截断。
 * - `DialogBody`：唯一的滚动层。外层的 Popup 负责裁剪圆角（`overflow-hidden`），
 *   滚动必须落在这一层，否则滚动条会戳出圆角（见 tests/popup_scroll_region.test.ts）。
 * - `DialogFooter`：纯布局的操作区，不带背景。此前的填充底色会在弹窗底部压出一条
 *   与正文不同色的横带，底部按钮看起来像挂在另一块面板上。
 *
 * 宽度语义固定为三种：一句话确认 / 提示用 `sm`，表单用默认 `md`，内容较多的详情用 `lg`。
 */

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/locales/i18n";

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
    <BaseDialog.Backdrop className="desktop-dialog-backdrop fixed inset-0 z-50 bg-scrim-strong backdrop-blur-[2px]" />
    <BaseDialog.Popup
      ref={ref}
      data-desktop-modal="true"
      className={cn(
        "desktop-dialog-popup fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-surface border border-border-subtle bg-background text-foreground shadow-2xl outline-none",
        dialog_size_class_names[size],
        className,
      )}
      {...props}
    >
      {children}
      {!hide_close ? <BaseDialog.Close render={<Button size="icon" className="absolute right-3 top-3" aria-label={translate("common:dialog.close")}><TbX /></Button>} /> : null}
    </BaseDialog.Popup>
  </BaseDialog.Portal>,
);
DialogContent.displayName = "DialogContent";

/** Dialog 标题。 */
const DialogTitle = React.forwardRef<HTMLHeadingElement, BaseDialog.Title.Props>(({ className, ...props }, ref) => <BaseDialog.Title ref={ref} className={cn("text-base font-semibold text-foreground", className)} {...props} />);
DialogTitle.displayName = "DialogTitle";

/** Dialog 说明。 */
const DialogDescription = React.forwardRef<HTMLParagraphElement, BaseDialog.Description.Props>(({ className, ...props }, ref) => <BaseDialog.Description ref={ref} className={cn("mt-1 text-2xs leading-4 text-muted-foreground", className)} {...props} />);
DialogDescription.displayName = "DialogDescription";

/** 头部图标徽章的语义色调。 */
type DialogIconTone = "neutral" | "danger";

/** 图标徽章底色：中性用于说明性弹窗，危险色用于删除等不可逆操作。 */
const dialog_icon_class_names: Record<DialogIconTone, string> = {
  neutral: "bg-surface-subtle text-muted-foreground",
  danger: "bg-destructive/10 text-destructive",
};

/** Dialog 头部属性。 */
interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 头部图标；省略则不渲染徽章。 */
  icon?: React.ReactNode;
  /** 图标徽章色调；风险操作传 `danger`。 */
  icon_tone?: DialogIconTone;
}

/** Dialog 头部布局：可选图标徽章 + 标题与说明。 */
function DialogHeader({ className, icon, icon_tone = "neutral", children, ...props }: DialogHeaderProps) {
  return <div className={cn("flex shrink-0 items-start gap-3 px-4 pb-3 pt-4 pr-12", className)} {...props}>
    {icon ? <div aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-item [&_svg]:size-4.5", dialog_icon_class_names[icon_tone])}>{icon}</div> : null}
    <div className="min-w-0 flex-1">{children}</div>
  </div>;
}

/** Dialog 主体布局，同时是唯一的内容滚动层。 */
function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex flex-1 flex-col overflow-y-auto px-4 pb-4", className)} {...props} />;
}

/** Dialog 底部操作区：只做布局，不带背景。按钮尺寸由调用点用 `size="action"` 指定。 */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-center justify-end gap-2 px-4 py-3", className)} {...props} />;
}

export { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };
export type { DialogIconTone, DialogSize };
