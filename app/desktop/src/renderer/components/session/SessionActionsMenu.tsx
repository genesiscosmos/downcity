/** Session 共享操作菜单，供 Sidebar 与 Chat 页头复用。 */

import { useState, type FormEvent, type ReactElement } from "react";
import { TbArchive, TbCopy, TbPencil, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";

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
}

/** 渲染与 Sidebar 一致的 Session 操作及确认流程。 */
export function SessionActionsMenu({ session, trigger, on_rename, on_archive, on_remove }: SessionActionsMenuProps) {
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
        <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>重命名</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => void on_archive()}><TbArchive /><span>归档</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(session.session_id)}><TbCopy /><span>复制 Session ID</span></DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>删除</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={rename_open} onOpenChange={set_rename_open}>
      <DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>重命名对话</DialogTitle><DialogDescription>标题会同步写入 Session，而不是只保存在界面中。</DialogDescription></DialogHeader>
          <DialogBody><input autoFocus value={title} onChange={(event) => set_title(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" /></DialogBody>
          <DialogFooter><Button type="button" onClick={() => set_rename_open(false)}>取消</Button><Button type="submit" variant="primary" disabled={pending || !title.trim()}>{pending ? "保存中…" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={remove_open} onOpenChange={set_remove_open}>
      <DialogContent>
        <DialogHeader><DialogTitle>删除对话</DialogTitle><DialogDescription>这会永久删除“{session.title || "新对话"}”及其消息，无法撤销。</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={() => set_remove_open(false)}>取消</Button><Button variant="destructive" disabled={pending} onClick={() => void remove()}>{pending ? "删除中…" : "删除"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
