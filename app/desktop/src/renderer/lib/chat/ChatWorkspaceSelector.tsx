/** ChatInput 使用的 Workspace 切换入口与确认交互。 */

import { TbCheck, TbChevronDown, TbFolder } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Workspace 选择器属性。 */
interface ChatWorkspaceSelectorProps {
  /** 当前 Workspace 标识。 */
  workspace_id: string;
  /** 可选 Workspace 列表。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前是否禁止切换。 */
  disabled: boolean;
  /** 确认后进入目标 Workspace 的新对话。 */
  switch_workspace(workspace_id: string): Promise<void> | void;
  /** 选择器的视觉规格。 */
  variant?: "tag" | "field";
}

/** 选择目标 Workspace，并在改变 Session 执行边界前显式确认。 */
export function ChatWorkspaceSelector(props: ChatWorkspaceSelectorProps) {
  const current = props.workspaces.find((workspace) => workspace.workspace_id === props.workspace_id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button className={props.variant === "field" ? "h-9 min-w-52 max-w-72 justify-start gap-2 rounded-lg border border-border/60 bg-background px-3 text-xs font-normal text-foreground shadow-none hover:bg-interaction-hover" : "h-5 min-w-0 max-w-40 gap-1 rounded-full bg-foreground/[0.045] px-2 text-[0.625rem] font-normal text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"} disabled={props.disabled || props.workspaces.length < 2} title={props.disabled ? "执行中不能切换 Workspace" : current?.name || "Workspace"}><TbFolder className={props.variant === "field" ? "size-4 shrink-0 text-muted-foreground" : "size-3 shrink-0"} /><span className="min-w-0 flex-1 truncate text-left">{current?.name || "Workspace"}</span><TbChevronDown className={props.variant === "field" ? "size-3.5 shrink-0 text-muted-foreground" : "size-2.5 shrink-0"} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4}>{props.workspaces.map((workspace) => <DropdownMenuItem key={workspace.workspace_id} disabled={workspace.workspace_id === props.workspace_id} onClick={() => void props.switch_workspace(workspace.workspace_id)}><TbFolder className="size-4" /><span className="min-w-0 flex-1 truncate">{workspace.name}</span>{workspace.workspace_id === props.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>
  );
}
