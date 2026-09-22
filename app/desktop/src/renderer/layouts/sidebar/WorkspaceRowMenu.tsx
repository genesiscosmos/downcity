/**
 * Workspace 根行的菜单。
 *
 * ```text
 * ＋ 新建对话          ← 对**这个 Workspace 里的会话**做的事
 * ─────────────
 *   复制路径          ← 对**目录本身**做的事
 *   在外部打开 ▸      ← 行首是外部打开图标，与两项去向同构
 *     ├ 在 VS Code 中打开
 *     └ 在 Finder 中打开
 * ─────────────
 *   移除工作区
 * ```
 *
 * 两类动作用分隔线分开：「开一条新对话」与「这个目录在哪」不是同一件事，
 * 排在一起会让人以为它们是一组。
 *
 * ## 两个「打开目录」的去向收进子菜单
 *
 * 它们说的是同一件事（把目录交给外部程序），差别只有交给谁，因此排在一个子菜单里，
 * 而不是并排占两行。子菜单项与 Chat 里的 `WorkspaceTagMenu` 同顺序：编辑器在前、
 * 文件管理器在后；那个菜单里目录是主角，两个去向直接铺开是对的，这里菜单还要承载
 * 会话与移除操作，展开成子菜单才能把主菜单留在「一类事一行」的粒度上。
 */

import { useState } from "react";
import { TbBrandFinder, TbBrandVscode, TbCopy, TbExternalLink, TbPlus, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RowMenuButton } from "@/components/RowMenuButton";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSubmenu, DropdownMenuSubmenuTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_translation } from "@/locales/i18n";
import type { ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 根行操作菜单属性。 */
interface WorkspaceRowMenuProps {
  /** 当前 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /**
   * 这个 Workspace 下面会话的汇总状态。
   *
   * 它直接落在**菜单入口按钮**上，与会话行完全同一套做法（`RowMenuButton` 的 `status`）：
   * 需要用户注意的状态常显、其余随行 hover / 聚焦 / 展开显形，
   * 而图标本身（旋转 / 警告 / 圆点）已经把状态说清了，不需要第二个图形。
   *
   * 行右端因此仍然只有**一个**交互目标，而不是“状态图标 + 菜单”两个。
   */
  status?: ChatRowStatus;
  /**
   * 这个 Workspace 新建对话时的默认联系人。
   *
   * 为空时不给「新建对话」项：没有可用 Agent 时点下去只会落进一个没有联系人的空对话，
   * 而一个点了没反应的菜单项比看不到它更糟（与 `NewChatButton` 同一条原则）。
   */
  default_agent_id?: string;
  /** 在这个 Workspace 为默认联系人打开空对话。 */
  on_open_draft?(workspace_id: string, agent_id: string): void;
  /** 从 Registry 移除 Workspace。 */
  on_remove(workspace_id: string): Promise<void>;
}

/** 提供新建对话、复制路径、在外部打开（VS Code / Finder）和移除 Workspace，并闭合移除确认状态。 */
export function WorkspaceRowMenu({ workspace, status, default_agent_id, on_open_draft, on_remove }: WorkspaceRowMenuProps) {
  const translate_common = use_translation("common");
  const translate = use_translation("resources");
  const translate_navigation = use_translation("navigation");
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
      <DropdownMenuTrigger asChild><RowMenuButton status={status} label={translate("workspace.item_actions", { name: workspace.name })} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
        {/* 「开一条新对话」排在最前：它是这个 Workspace 最常用的动作，而菜单入口又比行内的加号
            更好找（加号是 hover 才显形的）。它与下面的目录操作用分隔线分开，
            因为两者不是同一类事。 */}
        {default_agent_id && on_open_draft ? <>
          <DropdownMenuItem onClick={() => on_open_draft(workspace.workspace_id, default_agent_id)}><TbPlus /><span>{translate_navigation("sidebar.new_chat")}</span></DropdownMenuItem>
          <DropdownMenuSeparator />
        </> : null}
        <DropdownMenuItem onClick={() => void copy_path()}><TbCopy /><span>{translate(copied ? "workspace.copied" : "workspace.copy_path")}</span></DropdownMenuItem>
        {/* 子菜单浮层同样要停住冒泡：它虽然挂在 Portal 上，React 事件仍沿组件树冒到整行，
            不停住就会顺带触发行的「打开 Workspace」。 */}
        <DropdownMenuSubmenu>
          <DropdownMenuSubmenuTrigger><TbExternalLink /><span>{translate("workspace.open_external")}</span></DropdownMenuSubmenuTrigger>
          <DropdownMenuContent onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onClick={() => void window.downcity.system.open_in_vscode(workspace.workspace_path)}><TbBrandVscode /><span>{translate("workspace.open_vscode")}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => void window.downcity.system.open_local_file(workspace.workspace_path)}><TbBrandFinder /><span>{translate("workspace.open_finder")}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuSubmenu>
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
