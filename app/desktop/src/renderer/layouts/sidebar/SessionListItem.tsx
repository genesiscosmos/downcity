/** Duobox 风格 Session 导航项与操作菜单。 */

import { useState, type FormEvent } from "react";
import { TbArchive, TbCopy, TbDots, TbLoader2, TbPencil, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";

/** Session 导航项属性。 */
interface SessionListItemProps {
  /** Session 摘要。 */
  session: DesktopSessionSummary;
  /** Session 使用的 Agent 标识。 */
  agent_id: string;
  /** 是否选中。 */
  active: boolean;
  /** 进入 Session。 */
  on_select(): void;
  /** 修改标题。 */
  on_rename(title: string): Promise<void>;
  /** 归档 Session。 */
  on_archive(): Promise<void>;
  /** 永久删除 Session。 */
  on_remove(): Promise<void>;
}

/** 与 Duobox ThreadListItem 一致的行布局。 */
export function SessionListItem({ session, agent_id, active, on_select, on_rename, on_archive, on_remove }: SessionListItemProps) {
  const [rename_open, set_rename_open] = useState(false);
  const [remove_open, set_remove_open] = useState(false);
  const [title, set_title] = useState(session.title || "");
  const [pending, set_pending] = useState(false);

  const submit_rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    set_pending(true);
    try {
      await on_rename(title.trim());
      set_rename_open(false);
    } finally {
      set_pending(false);
    }
  };

  return <>
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex min-h-7 w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent p-0.5 pl-2 text-left transition-all duration-200 ease-out",
        active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
      )}
      onClick={on_select}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); on_select(); } }}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <span className="min-w-0 truncate text-xs leading-4 text-foreground">{session.title || "新对话"}</span>
      </div>
      <span className="max-w-20 shrink-0 truncate rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[0.5625rem] leading-3 text-muted-foreground group-hover:hidden">{agent_id}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className={cn("group/menu", session.executing ? "opacity-100" : "opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[state=open]:opacity-100")}
            title="更多操作"
            aria-label="更多操作"
            onClick={(event) => event.stopPropagation()}
          >
            {session.executing ? <TbLoader2 className="animate-spin text-primary" /> : <TbDots />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>重命名</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => void on_archive()}><TbArchive /><span>归档</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(session.session_id)}><TbCopy /><span>复制 Session ID</span></DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>删除</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

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
        <DialogFooter><Button onClick={() => set_remove_open(false)}>取消</Button><Button variant="destructive" disabled={pending} onClick={() => { set_pending(true); void on_remove().then(() => set_remove_open(false)).finally(() => set_pending(false)); }}>{pending ? "删除中…" : "删除"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
