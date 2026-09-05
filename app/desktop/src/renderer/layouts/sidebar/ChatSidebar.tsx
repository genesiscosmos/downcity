/** 仅负责选择 Agent 与 Group 聊天主体的全局 Chat Sidebar。 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TbChevronDown, TbChevronUp, TbDots, TbEdit, TbGhost3, TbLoader2, TbPlus, TbTrash, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { type DesktopController, type DesktopWorkspaceSession, type NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import type { DesktopModelSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarHeader } from "./SidebarHeader";
import { has_unread_agent_notification, has_unread_session_notification } from "@/lib/notification/notification_state";
import { SessionListItem, SessionListRow } from "./SessionListItem";
import { GroupSessionActionsMenu } from "@/components/session/GroupSessionActionsMenu";
import { use_desktop_selector } from "@/hooks/use_desktop_controller";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 当前通知快照，用于展示未读状态。 */
  notification_state: DesktopNotificationState;
  /** 打开创建 Agent 表单。 */
  open_create_agent(): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开 Group 配置页。 */
  open_group_config(group_id: string): void;
}

/** selector 未命中时复用同一空列表，保证 useSyncExternalStore 快照引用稳定。 */
const empty_workspace_sessions: DesktopWorkspaceSession[] = [];

/** 展示可进入聊天工作区的 Agent 与 Group。 */
export const ChatSidebar = memo(function ChatSidebar({ controller, notification_state, open_create_agent, open_create_group, open_group_config }: ChatSidebarProps) {
  const [sessions_collapsed, set_sessions_collapsed] = useState(() => localStorage.getItem("downcity.chat_sessions_collapsed") === "true");
  const [sessions_height, set_sessions_height] = useState(() => Number(localStorage.getItem("downcity.chat_sessions_height")) || 240);
  const [resizing_sessions, set_resizing_sessions] = useState(false);
  const sidebar_ref = useRef<HTMLDivElement | null>(null);
  const resize_start_y_ref = useRef(0);
  const resize_start_height_ref = useRef(0);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const selected_agent_id = selection && "agent_id" in selection ? selection.agent_id : "";
  const selected_group_id = selection && "group_id" in selection ? selection.group_id : "";
  const selected_agent = agents.find((agent) => agent.agent_id === selected_agent_id);
  const selected_group = groups.find((group) => group.group_id === selected_group_id);
  // 订阅当前选中 Agent 的 Session 列表（原始数组，引用稳定；只有该 Workspace 的列表变化才重渲染）。
  const agent_session_entries = use_desktop_selector(
    controller.stores.session,
    (state) => selected_agent_id
      ? state.sessions_by_workspace[active_workspace_id] ?? empty_workspace_sessions
      : empty_workspace_sessions,
  );
  const agent_sessions = useMemo(() => {
    if (!selected_agent) return [];
    const workspace_id = active_workspace_id;
    return agent_session_entries
      .filter((entry) => entry.agent_id === selected_agent.agent_id)
      .map((entry) => ({ workspace_id, session: entry.session }))
      .sort((left, right) => Number(right.session.executing) - Number(left.session.executing) || right.session.updated_at - left.session.updated_at);
  }, [active_workspace_id, agent_session_entries, selected_agent]);
  const toggle_sessions = () => set_sessions_collapsed((current) => {
    localStorage.setItem("downcity.chat_sessions_collapsed", String(!current));
    return !current;
  });
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;

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
      {agents.map((agent) => <AgentSubject key={agent.agent_id} agent={agent} controller={controller} selection={selection} active_workspace_id={active_workspace_id} workspaces={workspaces} models={models} notification_state={notification_state} />)}
      {groups.map((group) => <GroupSubject key={group.group_id} group={group} controller={controller} selection={selection} active_workspace_id={active_workspace_id} workspaces={workspaces} agents={agents} open_group_config={open_group_config} />)}
      {!loading && agents.length === 0 && groups.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">暂无聊天主体</div><Button className="mt-3" variant="primary" onClick={open_create_agent}>创建 Agent</Button></div> : null}
    </div>
    {selected_agent || selected_group ? <section aria-label={`${selected_agent?.name ?? selected_group?.name} 的对话列表`} className="relative mx-2 mb-2 flex shrink-0 flex-col overflow-hidden rounded-xl bg-surface-subtle" style={sessions_collapsed ? undefined : { height: sessions_height }}>
      {!sessions_collapsed ? <div role="separator" aria-orientation="horizontal" aria-label="调整对话列表高度" onMouseDown={start_sessions_resize} className="group absolute -top-1.5 left-0 z-10 flex h-3 w-full cursor-ns-resize items-center justify-center"><span className="h-px w-8 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground/25" /></div> : null}
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-expanded={!sessions_collapsed} onClick={toggle_sessions}>{sessions_collapsed ? <TbChevronUp className="size-3.5" /> : <TbChevronDown className="size-3.5" />}<span className="truncate">{selected_agent?.name ?? selected_group?.name} 的对话</span></button>
        <Button size="icon" title="新对话" aria-label="新对话" disabled={!workspace_id} onClick={() => { if (!workspace_id) return; if (selected_agent) void controller.actions.create_session(workspace_id, selected_agent.agent_id); else if (selected_group) void controller.actions.create_group_session(selected_group.group_id, workspace_id); }}><TbPlus /></Button>
      </div>
      {!sessions_collapsed ? <div className="sidebar-body-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
        {selected_agent ? agent_sessions.map(({ workspace_id: session_workspace_id, session }) => <SessionListItem key={`${session_workspace_id}:${session.session_id}`} session={session} active={selection?.kind === "session" && selection.session_id === session.session_id} unread={has_unread_session_notification(notification_state, session_workspace_id, selected_agent.agent_id, session.session_id)} on_select={() => void controller.actions.select_session(session_workspace_id, selected_agent.agent_id, session.session_id, true)} on_rename={(title) => controller.actions.rename_session(session_workspace_id, selected_agent.agent_id, session.session_id, title)} on_archive={() => controller.actions.archive_session(session_workspace_id, selected_agent.agent_id, session.session_id)} on_remove={() => controller.actions.remove_session(session_workspace_id, selected_agent.agent_id, session.session_id)} />) : null}
        {selected_group ? [...selected_group.sessions].sort((left, right) => right.updated_at - left.updated_at).map((session) => <SessionListRow key={session.session_id} title={session.title || "新对话"} active={selection?.kind === "group_session" && selection.session_id === session.session_id} on_select={() => void controller.actions.open_group(selected_group.group_id, session.session_id)} menu={<GroupSessionActionsMenu session={session} on_rename={(title) => controller.actions.rename_group_session(selected_group.group_id, session.session_id, title)} on_remove={() => controller.actions.remove_group_session(selected_group.group_id, session.session_id)} />} />) : null}
        {(selected_agent && agent_sessions.length === 0) || (selected_group && selected_group.sessions.length === 0) ? <div className="px-2 py-5 text-center text-[10px] text-muted-foreground/55">暂无对话</div> : null}
      </div> : null}
    </section> : null}
  </div>;
});

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, selection, active_workspace_id, workspaces, models, notification_state }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 当前导航目标。 */ selection: NavigationTarget | null; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 模型目录。 */ models: DesktopModelSummary[]; /** 通知快照。 */ notification_state: DesktopNotificationState }) {
  const [delete_open, set_delete_open] = useState(false);
  const model_label = models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || "未配置模型";
  // 布尔级订阅：只有该 Agent 的运行态翻转时才重渲染，消息流/runtime 的其它更新不触发。
  const running = use_desktop_selector(
    controller.stores.chat_stream,
    (state) => state.executing_agent_ids.has(agent.agent_id),
  );
  const active = selection && "agent_id" in selection && selection.agent_id === agent.agent_id;
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const unread = has_unread_agent_notification(notification_state, agent.agent_id);
  return <><ChatSubjectItem avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />} title={agent.name} tag={model_label} description={running ? "正在回复" : agent.description || "暂无描述"} active={Boolean(active)} unread={unread} status_active={running} on_select={() => void controller.actions.open_agent_chat(agent.agent_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Agent 操作" aria-label="Agent 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); }}><TbPlus /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => controller.actions.select_agent(agent.agent_id)}><TbEdit /><span>Agent 配置</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>删除 Agent</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={`永久删除 ${agent.name}？`} description="此操作无法撤销。Session、日志、Schedule、头像和 Plugin 数据都会被删除。" confirm_label="永久删除" on_confirm={() => controller.actions.remove_agent(agent.agent_id)} /></>;
});

/** 可直接进入聊天工作区的 Group 主体行。 */
const GroupSubject = memo(function GroupSubject({ group, controller, selection, active_workspace_id, workspaces, agents, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 当前导航目标。 */ selection: NavigationTarget | null; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const [delete_open, set_delete_open] = useState(false);
  const in_group = selection && "group_id" in selection && selection.group_id === group.group_id;
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  return <><ChatSubjectItem avatar={<GroupAvatar group={group} agents={agents} />} title={group.name} tag={`${group.members.length} 个成员`} description={group.instruction || "暂无描述"} active={Boolean(in_group)} on_select={() => void controller.actions.open_group(group.group_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="Group 操作" aria-label="Group 操作"><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_group_session(group.group_id, workspace_id); }}><TbPlus /><span>新对话</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>Group 配置</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>删除 Group</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={`删除 Group「${group.name}」？`} description={in_group ? "删除前将退出当前 Group。此操作无法撤销，成员与共享会话都会被删除。" : "此操作无法撤销，成员与共享会话都会被删除。"} confirm_label="删除" on_confirm={() => controller.actions.remove_group(group.group_id)} /></>;
});

/** 主体行删除前的确认 Dialog，统一承载危险操作的说明、错误与提交状态。 */
function SubjectDeleteDialog({ open, set_open, title, description, confirm_label, on_confirm }: {
  /** 是否可见。 */
  open: boolean;
  /** 修改可见性；提交中禁止关闭。 */
  set_open(open: boolean): void;
  /** 标题。 */
  title: string;
  /** 说明文案。 */
  description: string;
  /** 确认按钮文案。 */
  confirm_label: string;
  /** 确认回调；抛出错误时在 Dialog 内展示。 */
  on_confirm(): Promise<void> | void;
}) {
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");
  const confirm = async () => {
    if (pending) return;
    set_pending(true);
    set_error("");
    try {
      await on_confirm();
      set_open(false);
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      set_pending(false);
    }
  };
  return <Dialog open={open} onOpenChange={(next_open) => { if (!pending) set_open(next_open); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogBody>{error ? <div className="text-xs text-destructive">{error}</div> : null}</DialogBody>
      <DialogFooter><Button disabled={pending} onClick={() => set_open(false)}>取消</Button><Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? "删除中…" : confirm_label}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Agent 与 Group 共用的聊天主体行，只负责稳定展示结构和基础交互。 */
function ChatSubjectItem({ avatar, title, tag, description, active, unread = false, status_active = false, on_select, menu }: { /** 主体头像。 */ avatar: ReactNode; /** 主体名称。 */ title: string; /** 名称后的分类信息。 */ tag: string; /** 主体状态或说明。 */ description: ReactNode; /** 是否为当前主体。 */ active: boolean; /** 是否存在未读结果。 */ unread?: boolean; /** 副标题是否使用运行中强调色。 */ status_active?: boolean; /** 打开主体。 */ on_select(): void; /** 主体专属操作菜单。 */ menu: ReactNode }) {
  return <div className={cn("group flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150 [&_button]:cursor-pointer", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={on_select}><span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1.5"><span className="max-w-[55%] shrink truncate text-xs font-medium text-foreground">{title}</span><span className="max-w-36 shrink truncate rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] font-normal leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">{tag}</span></span><span className={cn("mt-1 flex items-center gap-1.5 truncate text-[10px]", status_active ? "chat-status-highlight text-[11px] font-medium" : "text-muted-foreground/70")}>{description}</span></span></button>
    <span className="relative flex size-7 shrink-0 items-center justify-center">
      {unread ? <span className="size-1.5 rounded-full bg-blue-500 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" aria-label="有未读完成结果" /> : null}
      {status_active ? <TbLoader2 className="size-3.5 animate-spin text-primary transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true" /> : null}
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">{menu}</span>
    </span>
  </div>;
}
