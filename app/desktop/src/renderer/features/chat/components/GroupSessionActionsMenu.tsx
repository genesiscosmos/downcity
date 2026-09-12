/** GroupSession 操作菜单：维护 canonical 标题并提供永久删除入口。 */

import { useState, type FormEvent } from "react";
import { TbDots, TbPencil, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { UnreadIndicator } from "@/components/UnreadIndicator";
import { cn } from "@/lib/utils";
import type { UnreadAttention } from "@/lib/notification/unread_attention";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopGroupSessionSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** 渲染 GroupSession 的重命名与删除流程。 */
export function GroupSessionActionsMenu({ session, unread_attention = null, on_rename, on_remove }: {
  /** 当前 GroupSession 摘要。 */
  session: DesktopGroupSessionSummary;
  /** 当前 GroupSession 未读通知表达的注意力等级；无未读时为 null。 */
  unread_attention?: UnreadAttention | null;
  /** 持久化新的 canonical 标题。 */
  on_rename(title: string): Promise<void>;
  /** 永久删除当前 GroupSession。 */
  on_remove(): Promise<void>;
}) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
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
        <Button size="icon" className={cn(unread_attention ? "opacity-100" : "opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[state=open]:opacity-100")} title={translate_common("actions.more")} aria-label={translate_common("actions.more")} onClick={(event) => event.stopPropagation()}>{unread_attention ? <UnreadIndicator attention={unread_attention} /> : <TbDots />}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => { set_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>{translate_chat("conversation.rename")}</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => set_remove_open(true)}><TbTrash /><span>{translate_common("actions.delete")}</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={rename_open} onOpenChange={set_rename_open}>
      <DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>{translate_chat("conversation.rename_title")}</DialogTitle><DialogDescription>{translate_chat("conversation.group_rename_description")}</DialogDescription></DialogHeader>
          <DialogBody><input autoFocus value={title} onChange={(event) => set_title(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" /></DialogBody>
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
