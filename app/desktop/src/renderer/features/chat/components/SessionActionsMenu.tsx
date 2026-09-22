/** Session 共享操作菜单，供 Sidebar 与 Chat 页头复用。 */

import { useState, type FormEvent, type ReactElement } from "react";
import { TbArchive, TbCheckbox, TbCopy, TbFolder, TbPencil, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** Session 共享操作菜单属性。 */
interface SessionActionsMenuProps {
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 菜单触发按钮。 */
  trigger: ReactElement;
  /** 修改 Session 标题。 */
  on_rename(title: string): Promise<void>;
  /** 归档 Session。 */
  on_archive(): Promise<void>;
  /** 永久删除 Session。 */
  on_remove(): Promise<void>;
  /** 进入多选模式并选中这一条；不传则不给这个入口。 */
  on_enter_selection?(): void;
}

/** 渲染与 Sidebar 一致的 Session 操作及确认流程。 */
export function SessionActionsMenu({ session, trigger, on_rename, on_archive, on_remove, on_enter_selection }: SessionActionsMenuProps) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const translate_navigation = use_translation("navigation");
  const [rename_open, set_rename_open] = useState(false);
  const [remove_open, set_remove_open] = useState(false);
  const [title, set_title] = useState(session.title || "");
  const [pending, set_pending] = useState(false);

  const submit_rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || pending) return;
    set_pending(true);
    try {
      await on_rename(title.trim());
      set_rename_open(false);
    } finally {
      set_pending(false);
    }
  };

  const remove = async () => {
    if (pending) return;
    set_pending(true);
    try {
      await on_remove();
      set_remove_open(false);
    } finally {
      set_pending(false);
    }
  };

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>{translate_chat("conversation.rename")}</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => void on_archive()}><TbArchive /><span>{translate_chat("conversation.archive")}</span></DropdownMenuItem>
        {/* 多选入口：Shift 点击是快路径，这里是可发现的那一条（鼠标用户不会去猜修饰键）。 */}
        {on_enter_selection ? <DropdownMenuItem onClick={on_enter_selection}><TbCheckbox /><span>{translate_navigation("sidebar.enter_selection")}</span></DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(session.session_path)}><TbFolder /><span>{translate_chat("conversation.copy_path")}</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(session.session_id)}><TbCopy /><span>{translate_chat("conversation.copy_session_id")}</span></DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>{translate_common("actions.delete")}</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={rename_open} onOpenChange={set_rename_open}>
      <DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>{translate_chat("conversation.rename_title")}</DialogTitle><DialogDescription>{translate_chat("conversation.rename_description")}</DialogDescription></DialogHeader>
          <DialogBody><input autoFocus value={title} onChange={(event) => set_title(event.target.value)} className="h-8 w-full rounded-control border border-input bg-background px-2.5 text-xs text-foreground" /></DialogBody>
          <DialogFooter><Button type="button" onClick={() => set_rename_open(false)}>{translate_common("actions.cancel")}</Button><Button type="submit" variant="primary" disabled={pending || !title.trim()}>{translate_common(pending ? "actions.saving" : "actions.save")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={remove_open} onOpenChange={set_remove_open}>
      <DialogContent>
        <DialogHeader><DialogTitle>{translate_chat("conversation.delete")}</DialogTitle><DialogDescription>{translate_chat("conversation.delete_description", { title: session.title || translate_chat("conversation.new") })}</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={() => set_remove_open(false)}>{translate_common("actions.cancel")}</Button><Button variant="destructive" disabled={pending} onClick={() => void remove()}>{pending ? translate_chat("conversation.deleting") : translate_common("actions.delete")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
