/** Workspace 根行的本地目录操作菜单。 */

import { useState } from "react";
import { TbCopy, TbExternalLink, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RowMenuButton } from "@/components/RowMenuButton";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_translation } from "@/locales/i18n";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 根行操作菜单属性。 */
interface WorkspaceRowMenuProps {
  /** 当前 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** 从 Registry 移除 Workspace。 */
  on_remove(workspace_id: string): Promise<void>;
}

/** 提供复制路径、Finder 打开和移除 Workspace，并闭合移除确认状态。 */
export function WorkspaceRowMenu({ workspace, on_remove }: WorkspaceRowMenuProps) {
  const translate_common = use_translation("common");
  const translate = use_translation("resources");
  const [copied, set_copied] = useState(false);
  const [remove_open, set_remove_open] = useState(false);
  const [removing, set_removing] = useState(false);
  const [remove_error, set_remove_error] = useState("");

  const copy_path = async () => {
    await navigator.clipboard.writeText(workspace.workspace_path);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  const remove = async () => {
    if (removing) return;
    set_removing(true);
    set_remove_error("");
    try {
      await on_remove(workspace.workspace_id);
      set_remove_open(false);
    } catch (reason) {
      set_remove_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_removing(false);
    }
  };

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><RowMenuButton label={translate("workspace.item_actions", { name: workspace.name })} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => void copy_path()}><TbCopy /><span>{translate(copied ? "workspace.copied" : "workspace.copy_path")}</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => void window.downcity.system.open_local_file(workspace.workspace_path)}><TbExternalLink /><span>{translate("workspace.open_finder")}</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => { set_remove_error(""); set_remove_open(true); }}><TbTrash /><span>{translate("workspace.remove")}</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={remove_open} onOpenChange={(next_open) => { if (!removing) set_remove_open(next_open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{translate("workspace.remove_title", { name: workspace.name })}</DialogTitle><DialogDescription>{translate("workspace.remove_description")}</DialogDescription></DialogHeader>
        <DialogBody>{remove_error ? <div className="text-xs text-destructive">{remove_error}</div> : <div className="text-xs text-muted-foreground">{translate("workspace.path_detail", { path: workspace.workspace_path })}</div>}</DialogBody>
        <DialogFooter><Button disabled={removing} onClick={() => set_remove_open(false)}>{translate_common("actions.cancel")}</Button><Button className="text-destructive" disabled={removing} onClick={() => void remove()}>{translate(removing ? "workspace.removing" : "workspace.remove")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
