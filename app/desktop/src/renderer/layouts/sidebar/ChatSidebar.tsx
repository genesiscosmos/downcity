/** 仅负责选择 Agent 与 Group 聊天主体的全局 Chat Sidebar。 */

import { useMemo, useState } from "react";
import { TbCopy, TbDots, TbEdit, TbGhost3, TbLoader2, TbMessageCircle, TbPlus, TbTrash, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { get_session_key, is_chat_busy, type DesktopViewController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { GroupEditorDialog } from "./AgentSidebar";
import { SidebarHeader } from "./SidebarHeader";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 打开创建 Agent 表单。 */
  open_create_agent(): void;
  /** 打开 Group 配置页。 */
  open_group_config(group_id: string): void;
}

/** 展示可进入聊天工作区的 Agent 与 Group。 */
export function ChatSidebar({ controller, open_create_agent, open_group_config }: ChatSidebarProps) {
  const [create_group_open, set_create_group_open] = useState(false);
  const session_count_by_agent = useMemo(() => Object.values(controller.sessions_by_workspace).flat().reduce<Record<string, number>>((result, item) => {
    result[item.agent_id] = (result[item.agent_id] ?? 0) + 1;
    return result;
  }, {}), [controller.sessions_by_workspace]);

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <SidebarHeader title="Chat" actions={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title="添加聊天主体" aria-label="添加聊天主体"><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_create_agent}><TbGhost3 /><span>创建 Agent</span></DropdownMenuItem><DropdownMenuItem onClick={() => set_create_group_open(true)}><TbUsers /><span>创建 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {controller.agents.map((agent) => <AgentSubject key={agent.agent_id} agent={agent} session_count={session_count_by_agent[agent.agent_id] ?? 0} controller={controller} />)}
      {controller.groups.map((group) => <GroupSubject key={group.group_id} group={group} controller={controller} open_group_config={open_group_config} />)}
      {!controller.loading && controller.agents.length === 0 && controller.groups.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">暂无聊天主体</div><Button className="mt-3" variant="primary" onClick={open_create_agent}>创建 Agent</Button></div> : null}
    </div>
    <GroupEditorDialog open={create_group_open} close_dialog={() => set_create_group_open(false)} agents={controller.agents} models={controller.models} models_loading={controller.models_loading} create_group={controller.create_group} />
  </div>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
function AgentSubject({ agent, session_count, controller }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** Agent Session 数量。 */ session_count: number; /** 根控制器。 */ controller: DesktopViewController }) {
  const model_label = controller.models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || "未配置模型";
  const running = Object.entries(controller.sessions_by_workspace).some(([workspace_id, sessions]) => sessions.some((item) => item.agent_id === agent.agent_id && (item.session.executing || is_chat_busy(controller.chat_runtime_by_session[get_session_key(workspace_id, agent.agent_id, item.session.session_id)]))));
  const active = controller.selection && "agent_id" in controller.selection && controller.selection.agent_id === agent.agent_id;
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;
  return <div className={cn("group flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => void controller.open_agent_chat(agent.agent_id)}><span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md"><AgentAvatar agent={agent} class_name="size-8 rounded-md" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{agent.agent_id}</span><span className={cn("mt-0.5 flex items-center gap-1 truncate text-[10px]", running ? "text-primary" : "text-muted-foreground/70")}>{running ? <><TbLoader2 className="size-3 animate-spin" />正在回复</> : `${model_label} · ${session_count} 个对话`}</span></span></button>
    <Button size="icon" className="opacity-0 group-hover:opacity-100" title="新对话" aria-label="新对话" disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.create_session(workspace_id, agent.agent_id); }}><TbPlus /></Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Agent 操作" aria-label="Agent 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.create_session(workspace_id, agent.agent_id); }}><TbMessageCircle /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => controller.select_agent(agent.agent_id)}><TbEdit /><span>Agent 配置</span></DropdownMenuItem><DropdownMenuItem onClick={() => void navigator.clipboard.writeText(agent.agent_id)}><TbCopy /><span>复制 Agent ID</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  </div>;
}

/** 可直接进入聊天工作区的 Group 主体行。 */
function GroupSubject({ group, controller, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 根控制器。 */ controller: DesktopViewController; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const active = controller.selection && "group_id" in controller.selection && controller.selection.group_id === group.group_id;
  return <div className={cn("group flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => void controller.open_group(group.group_id)}><GroupAvatar group={group} agents={controller.agents} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{group.name}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">{group.members.length} 个成员 · {group.sessions.length} 个对话</span></span></button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Group 操作" aria-label="Group 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void controller.create_group_session(group.group_id, controller.active_workspace_id || undefined)}><TbMessageCircle /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>Group 配置</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm(`确定删除 Group「${group.name}」吗？`)) void controller.remove_group(group.group_id); }}><TbTrash /><span>删除 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  </div>;
}

/** 使用 Group 成员头像组成紧凑主体头像。 */
function GroupAvatar({ group, agents }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** Agent 列表。 */ agents: DesktopAgentSummary[] }) {
  const members = group.members.slice(0, 3).map((member) => agents.find((agent) => agent.agent_id === member.agent_id) ?? { agent_id: member.agent_id, model_id: "", version: "" });
  if (members.length === 0) return <TbUsers className="size-8 shrink-0 rounded-full bg-foreground/[0.06] p-2 text-muted-foreground" />;
  return <span className="relative flex size-8 shrink-0 items-center" aria-label={`${group.name} 成员头像`}>{members.map((agent, index) => <AgentAvatar key={agent.agent_id} agent={agent} class_name={cn("absolute size-6 rounded-md border-2 border-muted", index === 0 && "left-0 top-0", index === 1 && "right-0 top-1", index === 2 && "left-1 bottom-0")} />)}</span>;
}
