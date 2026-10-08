/**
 * 统一确认弹窗。
 *
 * 删除、移除这类不可逆操作在应用里有近十处入口，此前的做法是每处各自写一遍
 * 「确认标题 + 风险说明 + 取消/确认按钮 + pending + 错误就地显示」：
 * 于是尺寸在 `sm` 与 `md` 之间摆动，危险按钮一半用 `variant="destructive"`、
 * 一半用 `className="text-destructive"`，还有一处（Group 会话删除）直接用了
 * 浏览器的 `window.confirm`，连样式都脱离了应用。
 *
 * 这里把这套行为收到一处：调用点只给文案与确认动作，尺寸、图标、按钮层级、
 * pending 禁用与失败提示都由组件决定。
 *
 * 失败不吞掉：错误显示在弹窗内部而不是抛到全局提示——用户此刻的注意力就在这个弹窗上，
 * 错误出现在别处等于没有提示。
 */

import { useState, type ReactNode } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { use_translation } from "@/locales/i18n";

/** 确认弹窗属性。 */
export interface ConfirmDialogProps {
  /** 当前是否可见。 */
  open: boolean;
  /** 修改可见性；执行中忽略关闭请求。 */
  set_open(open: boolean): void;
  /** 标题，说明这次操作的对象。 */
  title: string;
  /** 一句话风险说明，回答「会发生什么」；省略时不占位。 */
  description?: string;
  /** 确认按钮文案。 */
  confirm_label: string;
  /** 执行中的确认按钮文案；省略时沿用 `confirm_label`。 */
  pending_label?: string;
  /** 取消按钮文案；省略时用通用的「取消」。 */
  cancel_label?: string;
  /** 执行确认动作；抛出的错误会就地显示。 */
  on_confirm(): Promise<void> | void;
  /** 正文补充信息，例如目标路径或操作被阻止的原因。 */
  children?: ReactNode;
  /** 是否按不可逆操作呈现：危险色调的确认按钮与警示图标。 */
  destructive?: boolean;
}

/** 渲染确认弹窗，并闭合 pending 与失败提示。 */
export function ConfirmDialog({ open, set_open, title, description, confirm_label, pending_label, cancel_label, on_confirm, children, destructive = true }: ConfirmDialogProps) {
  const translate = use_translation();
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");

  const confirm = async () => {
    if (pending) return;
    set_pending(true);
    set_error("");
    try {
      await on_confirm();
      set_open(false);
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_pending(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next_open) => { if (!pending) set_open(next_open); }}>
    <DialogContent size="sm">
      <DialogHeader icon={destructive ? <TbAlertTriangle /> : undefined} icon_tone={destructive ? "danger" : "neutral"}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {/* 正文只在有补充信息或错误时占位；一个空白的 DialogBody 会在标题下留出一段无意义的空白。 */}
      {children || error
        ? <DialogBody className="text-xs">
          {error ? <div className="text-destructive">{error}</div> : <div className="text-muted-foreground">{children}</div>}
        </DialogBody>
        : null}
      <DialogFooter>
        <Button size="action" disabled={pending} onClick={() => set_open(false)}>{cancel_label || translate("actions.cancel")}</Button>
        <Button size="action" variant={destructive ? "destructive" : "primary"} disabled={pending} onClick={() => void confirm()}>{pending && pending_label ? pending_label : confirm_label}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
