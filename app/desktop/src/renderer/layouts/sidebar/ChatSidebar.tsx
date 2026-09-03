/** 仅负责选择 Agent 与 Group 聊天主体的全局 Chat Sidebar。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TbChevronDown, TbChevronUp, TbDots, TbEdit, TbGhost3, TbLoader2, TbPlus, TbTrash, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { get_session_key, is_chat_busy, type DesktopViewController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { SidebarHeader } from "./SidebarHeader";
import { has_unread_agent_notification, has_unread_session_notification } from "@/lib/notification/notification_state";
import { SessionListItem, SessionListRow } from "./SessionListItem";
import { GroupSessionActionsMenu } from "@/components/session/GroupSessionActionsMenu";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 打开创建 Agent 表单。 */
  open_create_agent(): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开 Group 配置页。 */
  open_group_config(group_id: string): void;
}

/** 展示可进入聊天工作区的 Agent 与 Group。 */
export function ChatSidebar({ controller, open_create_agent, open_create_group, open_group_config }: ChatSidebarProps) {
  const [sessions_collapsed, set_sessions_collapsed] = useState(() => localStorage.getItem("downcity.chat_sessions_collapsed") === "true");
  const [sessions_height, set_sessions_height] = useState(() => Number(localStorage.getItem("downcity.chat_sessions_height")) || 240);
  const [resizing_sessions, set_resizing_sessions] = useState(false);
  const sidebar_ref = useRef<HTMLDivElement | null>(null);
  const resize_start_y_ref = useRef(0);
  const resize_start_height_ref = useRef(0);
  const selected_agent_id = controller.selection && "agent_id" in controller.selection ? controller.selection.agent_id : "";
  const selected_group_id = controller.selection && "group_id" in controller.selection ? controller.selection.group_id : "";
  const selected_agent = controller.agents.find((agent) => agent.agent_id === selected_agent_id);
  const selected_group = controller.groups.find((group) => group.group_id === selected_group_id);
  const agent_sessions = selected_agent ? Object.entries(controller.sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries.filter((entry) => entry.agent_id === selected_agent.agent_id).map((entry) => ({ workspace_id, session: entry.session })))
    .sort((left, right) => Number(right.session.executing) - Number(left.session.executing) || right.session.updated_at - left.session.updated_at) : [];
  const toggle_sessions = () => set_sessions_collapsed((current) => {
    localStorage.setItem("downcity.chat_sessions_collapsed", String(!current));
    return !current;
  });
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;

  const start_sessions_resize = (event: React.MouseEvent) => {
    if (event.button !== 0 || sessions_collapsed) return;
    event.preventDefault();
    resize_start_y_ref.current = event.clientY;
    resize_start_height_ref.current = sessions_height;
    set_resizing_sessions(true);
  };

  useEffect(() => {
    if (!resizing_sessions) return;
    const previous_cursor = document.body.style.cursor;
    const previous_user_select = document.body.style.userSelect;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const handle_mouse_move = (event: MouseEvent) => {
      const sidebar_height = sidebar_ref.current?.clientHeight ?? window.innerHeight;
      const next_height = resize_start_height_ref.current + resize_start_y_ref.current - event.clientY;
      set_sessions_height(Math.max(120, Math.min(sidebar_height - 160, next_height)));
    };
    const handle_mouse_up = () => {
      set_resizing_sessions(false);
      set_sessions_height((current) => {
        localStorage.setItem("downcity.chat_sessions_height", String(current));
        return current;
      });
    };
    window.addEventListener("mousemove", handle_mouse_move);
    window.addEventListener("mouseup", handle_mouse_up);
    return () => {
      window.removeEventListener("mousemove", handle_mouse_move);
      window.removeEventListener("mouseup", handle_mouse_up);
      document.body.style.cursor = previous_cursor;
      document.body.style.userSelect = previous_user_select;
    };
  }, [resizing_sessions]);

  return <div ref={sidebar_ref} className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <SidebarHeader title="Chat" actions={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title="添加聊天主体" aria-label="添加聊天主体"><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_create_agent}><TbGhost3 /><span>创建 Agent</span></DropdownMenuItem><DropdownMenuItem onClick={open_create_group}><TbUsers /><span>创建 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />
    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
      {controller.agents.map((agent) => <AgentSubject key={agent.name} agent={agent} controller={controller} />)}
      {controller.groups.map((group) => <GroupSubject key={group.group_id} group={group} controller={controller} open_group_config={open_group_config} />)}
      {!controller.loading && controller.agents.length === 0 && controller.groups.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">暂无聊天主体</div><Button className="mt-3" variant="primary" onClick={open_create_agent}>创建 Agent</Button></div> : null}
    </div>
    {selected_agent || selected_group ? <section className="relative flex shrink-0 flex-col border-t border-border/35" style={sessions_collapsed ? undefined : { height: sessions_height }}>
      {!sessions_collapsed ? <div role="separator" aria-orientation="horizontal" aria-label="调整对话列表高度" onMouseDown={start_sessions_resize} className="group absolute -top-1.5 left-0 z-10 flex h-3 w-full cursor-ns-resize items-center justify-center"><span className="h-px w-full bg-transparent transition-colors group-hover:bg-primary/35" /></div> : null}
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-expanded={!sessions_collapsed} onClick={toggle_sessions}>{sessions_collapsed ? <TbChevronUp className="size-3.5" /> : <TbChevronDown className="size-3.5" />}<span className="truncate">{selected_agent?.name ?? selected_group?.name} 的对话</span></button>
        <Button size="icon" title="新对话" aria-label="新对话" disabled={!workspace_id} onClick={() => { if (!workspace_id) return; if (selected_agent) void controller.create_session(workspace_id, selected_agent.agent_id); else if (selected_group) void controller.create_group_session(selected_group.group_id, workspace_id); }}><TbPlus /></Button>
      </div>
      {!sessions_collapsed ? <div className="sidebar-body-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {selected_agent ? agent_sessions.map(({ workspace_id: session_workspace_id, session }) => <SessionListItem key={`${session_workspace_id}:${session.session_id}`} session={session} active={controller.selection?.kind === "session" && controller.selection.session_id === session.session_id} unread={has_unread_session_notification(controller.notification_state, session_workspace_id, selected_agent.agent_id, session.session_id)} on_select={() => void controller.select_session(session_workspace_id, selected_agent.agent_id, session.session_id, true)} on_rename={(title) => controller.rename_session(session_workspace_id, selected_agent.agent_id, session.session_id, title)} on_archive={() => controller.archive_session(session_workspace_id, selected_agent.agent_id, session.session_id)} on_remove={() => controller.remove_session(session_workspace_id, selected_agent.agent_id, session.session_id)} />) : null}
        {selected_group ? [...selected_group.sessions].sort((left, right) => right.updated_at - left.updated_at).map((session) => <SessionListRow key={session.session_id} title={session.title || "新对话"} active={controller.selection?.kind === "group_session" && controller.selection.session_id === session.session_id} on_select={() => void controller.open_group(selected_group.group_id, session.session_id)} menu={<GroupSessionActionsMenu session={session} on_rename={(title) => controller.rename_group_session(selected_group.group_id, session.session_id, title)} on_remove={() => controller.remove_group_session(selected_group.group_id, session.session_id)} />} />) : null}
        {(selected_agent && agent_sessions.length === 0) || (selected_group && selected_group.sessions.length === 0) ? <div className="px-2 py-5 text-center text-[10px] text-muted-foreground/55">暂无对话</div> : null}
      </div> : null}
    </section> : null}
  </div>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
function AgentSubject({ agent, controller }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 根控制器。 */ controller: DesktopViewController }) {
  const model_label = controller.models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || "未配置模型";
  const running = Object.entries(controller.sessions_by_workspace).some(([workspace_id, sessions]) => sessions.some((item) => item.agent_id === agent.agent_id && (item.session.executing || is_chat_busy(controller.chat_runtime_by_session[get_session_key(workspace_id, agent.agent_id, item.session.session_id)]))));
  const active = controller.selection && "agent_id" in controller.selection && controller.selection.agent_id === agent.agent_id;
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;
  const unread = has_unread_agent_notification(controller.notification_state, agent.agent_id);
  return <ChatSubjectItem avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />} title={agent.name} tag={model_label} description={running ? <><TbLoader2 className="size-3 animate-spin" />正在回复 · {agent.description || "暂无描述"}</> : agent.description || "暂无描述"} active={Boolean(active)} unread={unread} status_active={running} on_select={() => void controller.open_agent_chat(agent.agent_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Agent 操作" aria-label="Agent 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.create_session(workspace_id, agent.agent_id); }}><TbPlus /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => controller.select_agent(agent.agent_id)}><TbEdit /><span>Agent 配置</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />;
}

/** 可直接进入聊天工作区的 Group 主体行。 */
function GroupSubject({ group, controller, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 根控制器。 */ controller: DesktopViewController; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const active = controller.selection && "group_id" in controller.selection && controller.selection.group_id === group.group_id;
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;
  return <ChatSubjectItem avatar={<GroupAvatar group={group} agents={controller.agents} />} title={group.name} tag={`${group.members.length} 个成员`} description={group.instruction || "暂无描述"} active={Boolean(active)} on_select={() => void controller.open_group(group.group_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Group 操作" aria-label="Group 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.create_group_session(group.group_id, workspace_id); }}><TbPlus /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>Group 配置</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm(`确定删除 Group「${group.name}」吗？`)) void controller.remove_group(group.group_id); }}><TbTrash /><span>删除 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />;
}

/** Agent 与 Group 共用的聊天主体行，只负责稳定展示结构和基础交互。 */
function ChatSubjectItem({ avatar, title, tag, description, active, unread = false, status_active = false, on_select, menu }: { /** 主体头像。 */ avatar: ReactNode; /** 主体名称。 */ title: string; /** 名称后的分类信息。 */ tag: string; /** 主体状态或说明。 */ description: ReactNode; /** 是否为当前主体。 */ active: boolean; /** 是否存在未读结果。 */ unread?: boolean; /** 副标题是否使用运行中强调色。 */ status_active?: boolean; /** 打开主体。 */ on_select(): void; /** 主体专属操作菜单。 */ menu: ReactNode }) {
  return <div className={cn("group flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={on_select}><span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1.5"><span className="max-w-[55%] shrink truncate text-xs font-medium text-foreground">{title}</span><span className="max-w-36 shrink truncate rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] font-normal leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">{tag}</span>{unread ? <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-label="有未读完成结果" /> : null}</span><span className={cn("mt-1 flex items-center gap-1 truncate text-[10px]", status_active ? "text-primary" : "text-muted-foreground/70")}>{description}</span></span></button>
    {menu}
  </div>;
}
