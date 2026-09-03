/** GroupSession 操作菜单：维护 canonical 标题并提供永久删除入口。 */

import { useState, type FormEvent } from "react";
import { TbDots, TbPencil, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopGroupSessionSummary } from "@common/types/DesktopApi";

/** 渲染 GroupSession 的重命名与删除流程。 */
export function GroupSessionActionsMenu({ session, on_rename, on_remove }: {
  /** 当前 GroupSession 摘要。 */
  session: DesktopGroupSessionSummary;
  /** 持久化新的 canonical 标题。 */
  on_rename(title: string): Promise<void>;
  /** 永久删除当前 GroupSession。 */
  on_remove(): Promise<void>;
}) {
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
      <DropdownMenuTrigger asChild>
        <Button size="icon" className="opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[state=open]:opacity-100" title="更多操作" aria-label="更多操作" onClick={(event) => event.stopPropagation()}><TbDots /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>重命名</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>删除</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={rename_open} onOpenChange={set_rename_open}>
      <DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>重命名对话</DialogTitle><DialogDescription>标题会同步写入 GroupSession，而不是只保存在界面中。</DialogDescription></DialogHeader>
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
