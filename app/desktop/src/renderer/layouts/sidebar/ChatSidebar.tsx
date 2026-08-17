/** 以可折叠 Workspace 文档树组织 Session 的 Chat Sidebar。 */

import { useEffect, useState } from "react";
import { TbArchive, TbChevronRight, TbDots, TbFolder, TbFolderPlus, TbGhost3, TbPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopViewController } from "@/types/DesktopView";
import { SessionListItem } from "./SessionListItem";

const expanded_workspaces_storage_key = "downcity.expanded_workspace_ids";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** 根状态控制器。 */
  controller: DesktopViewController;
  /** 打开 Workspace 创建流程。 */
  open_create_workspace(): void;
  /** 打开 Agent 创建流程。 */
  open_create_agent(workspace_id: string): void;
}

/** 读取持久化的 Workspace 展开状态。 */
function read_expanded_workspace_ids(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(expanded_workspaces_storage_key) || "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Workspace 是可独立展开的目录，Session 直接列在目录之下。 */
export function ChatSidebar({ controller, open_create_workspace, open_create_agent }: ChatSidebarProps) {
  const [expanded_workspace_ids, set_expanded_workspace_ids] = useState(read_expanded_workspace_ids);
  const [archive_workspace_id, set_archive_workspace_id] = useState<string>();

  useEffect(() => {
    if (controller.workspaces.length === 0 || localStorage.getItem(expanded_workspaces_storage_key) !== null) return;
    const workspace_ids = new Set(controller.workspaces.map((workspace) => workspace.workspace_id));
    set_expanded_workspace_ids(workspace_ids);
    localStorage.setItem(expanded_workspaces_storage_key, JSON.stringify([...workspace_ids]));
  }, [controller.workspaces]);

  const toggle_workspace = (workspace_id: string) => {
    set_expanded_workspace_ids((current) => {
      const next = new Set(current);
      if (next.has(workspace_id)) next.delete(workspace_id);
      else next.add(workspace_id);
      localStorage.setItem(expanded_workspaces_storage_key, JSON.stringify([...next]));
      return next;
    });
  };

  const create_session = (workspace_id: string, agent_id: string) => {
    set_expanded_workspace_ids((current) => {
      const next = new Set(current).add(workspace_id);
      localStorage.setItem(expanded_workspaces_storage_key, JSON.stringify([...next]));
      return next;
    });
    void controller.create_session(workspace_id, agent_id);
  };

  const open_archives = (workspace_id: string) => {
    set_archive_workspace_id(workspace_id);
    void controller.load_archived_sessions(workspace_id);
  };

  const archived_workspace = controller.workspaces.find((workspace) => workspace.workspace_id === archive_workspace_id);
  const archived_sessions = archive_workspace_id ? controller.archived_sessions_by_workspace[archive_workspace_id] ?? [] : [];

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {controller.workspaces.length === 0 ? <EmptyWorkspace open_create_workspace={open_create_workspace} /> : null}
      {controller.workspaces.map((workspace) => {
        const expanded = expanded_workspace_ids.has(workspace.workspace_id);
        const sessions = [...(controller.sessions_by_workspace[workspace.workspace_id] ?? [])]
          .sort((left, right) => Number(right.session.executing) - Number(left.session.executing) || right.session.updated_at - left.session.updated_at);
        const draft = controller.selection?.kind === "draft" && controller.selection.workspace_id === workspace.workspace_id
          ? controller.selection
          : undefined;
        return <section key={workspace.workspace_id} className="mb-0.5">
          <div className="group flex min-h-7 w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent p-0.5 transition-all duration-200 ease-out hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.07]" onClick={() => toggle_workspace(workspace.workspace_id)}>
            <Button size="icon" aria-label={expanded ? "折叠 Workspace" : "展开 Workspace"} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggle_workspace(workspace.workspace_id); }}>
              <TbChevronRight className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-1 text-left">
              <TbFolder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{workspace.name}</span>
            </div>
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="新对话" aria-label="新对话" onClick={(event) => event.stopPropagation()}><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4} onClick={(event) => event.stopPropagation()}>{controller.agents.map((agent) => <DropdownMenuItem key={agent.agent_id} onClick={() => create_session(workspace.workspace_id, agent.agent_id)}><TbGhost3 /><span>{agent.agent_id}</span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Workspace 操作" aria-label="Workspace 操作" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={4} onClick={(event) => event.stopPropagation()}><DropdownMenuItem onClick={() => open_archives(workspace.workspace_id)}><TbArchive /><span>已归档对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_create_agent(workspace.workspace_id)}><TbGhost3 /><span>创建 Agent</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </div>
          {expanded ? <div className="space-y-0.5 pl-5">
            {draft ? <div className="flex min-h-7 items-center gap-1 rounded-lg bg-primary/[0.1] px-2"><span className="min-w-0 flex-1 truncate text-xs text-foreground">新对话</span><span className="max-w-20 truncate rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[0.5625rem] text-muted-foreground">{draft.agent_id}</span></div> : null}
            {sessions.map(({ agent_id, session }) => <SessionListItem
              key={`${agent_id}:${session.session_id}`}
              session={session}
              agent_id={agent_id}
              active={controller.selection?.kind === "session" && controller.selection.workspace_id === workspace.workspace_id && controller.selection.agent_id === agent_id && controller.selection.session_id === session.session_id}
              on_select={() => void controller.select_session(workspace.workspace_id, agent_id, session.session_id)}
              on_rename={(title) => controller.rename_session(workspace.workspace_id, agent_id, session.session_id, title)}
              on_archive={() => controller.archive_session(workspace.workspace_id, agent_id, session.session_id)}
              on_remove={() => controller.remove_session(workspace.workspace_id, agent_id, session.session_id)}
            />)}
            {sessions.length === 0 && !draft ? <div className="px-2 py-2 text-[0.6875rem] text-muted-foreground/60">暂无对话</div> : null}
          </div> : null}
        </section>;
      })}
    </div>
    <Dialog open={Boolean(archive_workspace_id)} onOpenChange={(open) => { if (!open) set_archive_workspace_id(undefined); }}><DialogContent><DialogHeader><DialogTitle>已归档对话</DialogTitle><DialogDescription>{archived_workspace?.name || "Workspace"} 下的归档 Session。</DialogDescription></DialogHeader><DialogBody className="max-h-80 overflow-y-auto px-3">{archived_sessions.map(({ agent_id, session }) => <div key={`${agent_id}:${session.session_id}`} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs text-foreground hover:bg-foreground/[0.05]"><span className="min-w-0 flex-1 truncate">{session.title || "新对话"}</span><span className="max-w-24 truncate rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">{agent_id}</span></div>)}{archived_sessions.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无已归档对话</div> : null}</DialogBody></DialogContent></Dialog>
  </div>;
}

/** 尚未添加 Workspace 的空状态。 */
function EmptyWorkspace({ open_create_workspace }: { /** 打开 Workspace 创建流程。 */ open_create_workspace(): void }) {
  return <div className="flex flex-col items-center px-4 py-10 text-center"><TbFolderPlus className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">添加 Workspace</div><Button className="mt-3" variant="primary" onClick={open_create_workspace}>添加</Button></div>;
}
