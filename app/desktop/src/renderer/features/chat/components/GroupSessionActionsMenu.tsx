/**
 * GroupSession 操作菜单：重命名与永久删除。
 *
 * Group 会话没有归档语义（只有 Agent Session 有），所以它的菜单比 `SessionActionsMenu` 少几项，
 * 与 Group 页头菜单保持同一套动作。
 *
 * 它与 `SessionActionsMenu` 分工明确、不要合并：后者的归档、复制路径、复制 Session ID 都依赖
 * Agent Session 的目录字段，硬合并会逼出一堆「Group 时该字段为空」的分支。
 */

import { useState, type FormEvent } from "react";
import { TbArchive, TbCheckbox, TbPencil, TbTrash } from "react-icons/tb";
import { RowMenuButton } from "@/components/RowMenuButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { use_translation } from "@/locales/i18n";
import type { DesktopGroupSessionSummary } from "@common/types/DesktopApi";

/** 渲染 GroupSession 的归档、重命名与删除流程。 */
export function GroupSessionActionsMenu({ session, status, on_rename, on_archive, on_remove, on_enter_selection }: {
  /** 当前 GroupSession 摘要。 */
  session: DesktopGroupSessionSummary;
  /** 当前 GroupSession 的行状态；决定入口图标与显隐。 */
  status: ChatRowStatus;
  /** 持久化新的 canonical 标题。 */
  on_rename(title: string): Promise<void>;
  /** 归档当前 GroupSession；不传则不给这个入口。 */
  on_archive?(): Promise<void>;
  /** 永久删除当前 GroupSession。 */
  on_remove(): Promise<void>;
  /** 进入多选模式并选中这一条；不传则不给这个入口。 */
  on_enter_selection?(): void;
}) {
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
      <DropdownMenuTrigger asChild><RowMenuButton status={status} label={translate_common("actions.more")} /></DropdownMenuTrigger>
      {/* 菜单里的点击不要冒泡到所在行，否则会顺带选中这个会话。 */}
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>{translate_chat("conversation.rename")}</span></DropdownMenuItem>
        {/* 归档与 Agent Session 菜单同形：可逆动作放在危险动作之前，中间用分隔线隔开。 */}
        {on_archive ? <DropdownMenuItem onClick={() => void on_archive()}><TbArchive /><span>{translate_chat("conversation.archive")}</span></DropdownMenuItem> : null}
        {/* 多选入口：Shift 点击是快路径，这里是可发现的那一条（鼠标用户不会去猜修饰键）。 */}
        {on_enter_selection ? <DropdownMenuItem onClick={on_enter_selection}><TbCheckbox /><span>{translate_navigation("sidebar.enter_selection")}</span></DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>{translate_common("actions.delete")}</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={rename_open} onOpenChange={set_rename_open}>
      <DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>{translate_chat("conversation.rename_title")}</DialogTitle><DialogDescription>{translate_chat("conversation.group_rename_description")}</DialogDescription></DialogHeader>
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
