/** 按 Workspace 打开的 Agent Session Sidebar。 */

import { useState } from "react";
import { TbArchive, TbChevronDown, TbDots, TbFolder, TbFolderPlus, TbPlus, TbRobot } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopViewController } from "@/types/DesktopView";
import { SessionListItem } from "./SessionListItem";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** 根状态控制器。 */
  controller: DesktopViewController;
  /** 打开 Workspace 创建流程。 */
  open_create_workspace(): void;
  /** 在当前 Workspace 创建 Agent。 */
  open_create_agent(workspace_id: string): void;
}

/** 先打开 Workspace，再按 Agent 分组展示 Session。 */
export function ChatSidebar({ controller, open_create_workspace, open_create_agent }: ChatSidebarProps) {
  const [archive_open, set_archive_open] = useState(false);
  const workspace = controller.workspaces.find((item) => item.workspace_id === controller.active_workspace_id) ?? controller.workspaces[0];
  const workspace_agents = controller.agents;

  const open_archives = () => {
    set_archive_open(true);
    for (const agent of workspace_agents) void controller.load_archived_sessions(agent.agent_id);
  };

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button className="min-w-0 flex-1 justify-start px-1 text-xs font-semibold text-foreground"><TbFolder /><span className="min-w-0 flex-1 truncate text-left">{workspace?.name || "打开 Workspace"}</span><TbChevronDown className="text-muted-foreground" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="w-64">
          {controller.workspaces.map((item) => <DropdownMenuItem key={item.workspace_id} is_selected={item.workspace_id === workspace?.workspace_id} onClick={() => controller.select_workspace(item.workspace_id)}><TbFolder /><span className="min-w-0 flex-1 truncate">{item.name}</span></DropdownMenuItem>)}
          {controller.workspaces.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={open_create_workspace}><TbFolderPlus /><span>添加 Workspace</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title="Workspace 对话操作" aria-label="Workspace 对话操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4}><DropdownMenuItem disabled={workspace_agents.length === 0} onClick={open_archives}><TbArchive /><span>已归档对话</span></DropdownMenuItem><DropdownMenuItem disabled={!workspace} onClick={() => workspace && open_create_agent(workspace.workspace_id)}><TbRobot /><span>创建 Agent</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title="新对话" aria-label="新对话" disabled={workspace_agents.length === 0}><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4}>{workspace_agents.map((agent) => <DropdownMenuItem key={agent.agent_id} onClick={() => void controller.create_session(agent.agent_id)}><TbRobot /><span>{agent.agent_id}</span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </div>

    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {!workspace ? <EmptyWorkspace open_create_workspace={open_create_workspace} /> : null}
      {workspace && workspace_agents.length === 0 ? <EmptyAgent workspace_name={workspace.name} open_create_agent={() => open_create_agent(workspace.workspace_id)} /> : null}
      {workspace_agents.map((agent) => {
        const sessions = [...(controller.sessions_by_agent[agent.agent_id] ?? [])].sort((left, right) => Number(right.executing) - Number(left.executing) || right.updated_at - left.updated_at);
        const draft_active = controller.selection?.kind === "draft" && controller.selection.agent_id === agent.agent_id;
        return <section key={agent.agent_id} className="mb-3">
          <div className="group flex h-7 items-center gap-1 px-1"><TbRobot className="size-3.5 shrink-0 text-muted-foreground" /><button className="min-w-0 flex-1 truncate text-left text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground" onClick={() => controller.select_agent(agent.agent_id)}>{agent.agent_id}</button><Button size="icon" className="opacity-0 group-hover:opacity-100" title={`使用 ${agent.agent_id} 新建对话`} onClick={() => void controller.create_session(agent.agent_id)}><TbPlus /></Button></div>
          {draft_active ? <button className="mb-0.5 flex min-h-7 w-full items-center rounded-lg bg-primary/[0.1] px-2 text-left text-xs text-foreground" onClick={() => void controller.create_session(agent.agent_id)}>新对话</button> : null}
          {sessions.map((session) => <SessionListItem
            key={session.session_id}
            session={session}
            active={controller.selection?.kind === "session" && controller.selection.agent_id === agent.agent_id && controller.selection.session_id === session.session_id}
            on_select={() => void controller.select_session(agent.agent_id, session.session_id)}
            on_rename={(title) => controller.rename_session(agent.agent_id, session.session_id, title)}
            on_archive={() => controller.archive_session(agent.agent_id, session.session_id)}
            on_remove={() => controller.remove_session(agent.agent_id, session.session_id)}
          />)}
          {sessions.length === 0 && !draft_active ? <div className="px-2 py-2 text-[0.6875rem] text-muted-foreground/60">暂无对话</div> : null}
        </section>;
      })}
    </div>

    <Dialog open={archive_open} onOpenChange={set_archive_open}><DialogContent><DialogHeader><DialogTitle>已归档对话</DialogTitle><DialogDescription>{workspace?.name || "Workspace"} 下各 Agent 的归档 Session。</DialogDescription></DialogHeader><DialogBody className="max-h-80 overflow-y-auto px-3">{workspace_agents.flatMap((agent) => (controller.archived_sessions_by_agent[agent.agent_id] ?? []).map((session) => ({ agent, session }))).map(({ agent, session }) => <div key={`${agent.agent_id}:${session.session_id}`} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs text-foreground hover:bg-foreground/[0.05]"><TbRobot className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{session.title || "新对话"}</span><span className="max-w-24 truncate text-[0.625rem] text-muted-foreground">{agent.agent_id}</span></div>)}{workspace_agents.every((agent) => (controller.archived_sessions_by_agent[agent.agent_id] ?? []).length === 0) ? <div className="py-8 text-center text-xs text-muted-foreground">暂无已归档对话</div> : null}</DialogBody></DialogContent></Dialog>
  </div>;
}

/** 尚未添加 Workspace 的空状态。 */
function EmptyWorkspace({ open_create_workspace }: { /** 打开 Workspace 创建流程。 */ open_create_workspace(): void }) { return <div className="flex flex-col items-center px-4 py-10 text-center"><TbFolderPlus className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">添加 Workspace</div><div className="mt-1 text-[0.6875rem] leading-4 text-muted-foreground">打开一个本地目录后，再使用其中 Agent 的 Session。</div><Button className="mt-3" variant="primary" onClick={open_create_workspace}>添加</Button></div>; }

/** Workspace 尚无 Agent 的空状态。 */
function EmptyAgent({ workspace_name, open_create_agent }: { /** Workspace 名称。 */ workspace_name: string; /** 创建 Agent。 */ open_create_agent(): void }) { return <div className="flex flex-col items-center px-4 py-10 text-center"><TbRobot className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{workspace_name} 中没有 Agent</div><div className="mt-1 text-[0.6875rem] leading-4 text-muted-foreground">创建 Agent 后即可在这个 Workspace 中开始对话。</div><Button className="mt-3" variant="primary" onClick={open_create_agent}>创建 Agent</Button></div>; }
