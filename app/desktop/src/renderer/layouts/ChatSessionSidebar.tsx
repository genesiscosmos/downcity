/** 当前聊天主体拥有的可折叠、可调整宽度 Session 内部侧边栏。 */

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TbComponents, TbDots, TbFileText, TbHome, TbMessageCircle, TbPlus, TbSettings, TbTrash, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { SessionListItem, SessionListRow } from "./sidebar/SessionListItem";
import { use_main_view_header_controls } from "./MainViewLayout";
import { get_chat_header_left_inset, SHELL_PANEL_TRANSITION } from "./shellMotion";

const chat_session_sidebar_min_width = 220;
const chat_session_sidebar_max_width = 380;
const chat_session_sidebar_default_width = 272;

/** Agent Session 内部侧边栏属性。 */
interface AgentChatSessionSidebarProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 是否完全折叠内部 Session Sidebar。 */
  collapsed: boolean;
  /** 切换内部 Session Sidebar。 */
  toggle_collapsed(): void;
  /** 当前 Left Panel Tab。 */
  active_tab?: "chat" | "config";
  /** 切换 Left Panel Tab。 */
  select_tab?: (tab: "chat" | "config") => void;
  /** 当前 Agent 配置分区。 */
  active_section?: "model" | "soul" | "plugins";
  /** 打开 Agent 配置分区。 */
  open_config?: (section?: "model" | "soul" | "plugins") => void;
}

/** 展示当前 Agent 跨 Workspace 的全部 Session。 */
export function AgentChatSessionSidebar({ agent, controller, collapsed, active_tab = "chat", select_tab, active_section, open_config }: AgentChatSessionSidebarProps) {
  const sessions = Object.entries(controller.sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries.filter((entry) => entry.agent_id === agent.agent_id).map((entry) => ({ workspace_id, session: entry.session })))
    .sort((left, right) => Number(right.session.executing) - Number(left.session.executing) || right.session.updated_at - left.session.updated_at);
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;
  return <ChatSessionSidebarFrame collapsed={collapsed} title={agent.agent_id} avatar={<AgentAvatar agent={agent} class_name="size-5 rounded-md" />} create_session={() => { if (workspace_id) void controller.create_session(workspace_id, agent.agent_id); }} create_disabled={!workspace_id} create_active={controller.selection?.kind === "draft" && controller.selection.agent_id === agent.agent_id} active_tab={active_tab} config_label="Agent" select_tab={select_tab}>
    {active_tab === "chat" ? sessions.map(({ workspace_id: session_workspace_id, session }) => <SessionListItem key={`${session_workspace_id}:${session.session_id}`} session={session} active={controller.selection?.kind === "session" && controller.selection.agent_id === agent.agent_id && controller.selection.session_id === session.session_id} on_select={() => void controller.select_session(session_workspace_id, agent.agent_id, session.session_id, true)} on_rename={(title) => controller.rename_session(session_workspace_id, agent.agent_id, session.session_id, title)} on_archive={() => controller.archive_session(session_workspace_id, agent.agent_id, session.session_id)} on_remove={() => controller.remove_session(session_workspace_id, agent.agent_id, session.session_id)} />) : <><ConfigNavigationItem icon={<TbHome />} title="General" active={!active_section} on_select={() => open_config?.()} /><ConfigNavigationItem icon={<TbSettings />} title="Model" active={active_section === "model"} on_select={() => open_config?.("model")} /><ConfigNavigationItem icon={<TbFileText />} title="SOUL.md" active={active_section === "soul"} on_select={() => open_config?.("soul")} /><ConfigNavigationItem icon={<TbComponents />} title="Plugins" active={active_section === "plugins"} on_select={() => open_config?.("plugins")} /></>}
  </ChatSessionSidebarFrame>;
}

/** Group Session 内部侧边栏属性。 */
interface GroupChatSessionSidebarProps {
  /** 当前 Group。 */
  group: DesktopGroupSummary;
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 是否完全折叠内部 Session Sidebar。 */
  collapsed: boolean;
  /** 切换内部 Session Sidebar。 */
  toggle_collapsed(): void;
  /** 当前 Left Panel Tab。 */
  active_tab?: "chat" | "config";
  /** 切换 Left Panel Tab。 */
  select_tab?: (tab: "chat" | "config") => void;
  /** 当前 Group 配置分区。 */
  active_section?: "model" | "instruction" | "members";
  /** 打开 Group 配置分区。 */
  open_config?: (section?: "model" | "instruction" | "members") => void;
}

/** 展示当前 Group 的全部 GroupSession。 */
export function GroupChatSessionSidebar({ group, controller, collapsed, active_tab = "chat", select_tab, active_section, open_config }: GroupChatSessionSidebarProps) {
  const sessions = [...group.sessions].sort((left, right) => right.updated_at - left.updated_at);
  return <ChatSessionSidebarFrame collapsed={collapsed} title={group.name} avatar={<TbMessageCircle className="size-4 text-muted-foreground" />} create_session={() => void controller.create_group_session(group.group_id, controller.active_workspace_id || undefined)} active_tab={active_tab} config_label="Group" select_tab={select_tab}>
    {active_tab === "chat" ? sessions.map((session) => <SessionListRow key={session.session_id} title={session.preview_text || "新对话"} active={controller.selection?.kind === "group_session" && controller.selection.group_id === group.group_id && controller.selection.session_id === session.session_id} on_select={() => void controller.open_group(group.group_id, session.session_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title="更多操作" aria-label="更多操作" onClick={(event) => event.stopPropagation()}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}><DropdownMenuItem className="text-destructive" onClick={() => void controller.remove_group_session(group.group_id, session.session_id)}><TbTrash /><span>删除</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />) : <><ConfigNavigationItem icon={<TbHome />} title="配置首页" active={!active_section} on_select={() => open_config?.()} /><ConfigNavigationItem icon={<TbSettings />} title="Model" active={active_section === "model"} on_select={() => open_config?.("model")} /><ConfigNavigationItem icon={<TbFileText />} title="目标" active={active_section === "instruction"} on_select={() => open_config?.("instruction")} /><ConfigNavigationItem icon={<TbUsers />} title="成员" active={active_section === "members"} on_select={() => open_config?.("members")} /></>}
  </ChatSessionSidebarFrame>;
}

/** 内部 Session 导航的固定布局。 */
function ChatSessionSidebarFrame({ collapsed, title, avatar, create_session, create_disabled = false, create_active = false, active_tab, config_label, select_tab, children }: { /** 是否完全折叠。 */ collapsed: boolean; /** 主体名称。 */ title: string; /** 主体头像。 */ avatar: React.ReactNode; /** 创建 Session。 */ create_session(): void; /** 是否禁止创建。 */ create_disabled?: boolean; /** 新建对话是否承载当前 Draft 选中态。 */ create_active?: boolean; /** 当前导航 Tab。 */ active_tab: "chat" | "config"; /** 配置 Tab 标题。 */ config_label: string; /** 切换导航 Tab。 */ select_tab?: (tab: "chat" | "config") => void; /** Session 或配置导航项。 */ children: React.ReactNode }) {
  const controls = use_main_view_header_controls();
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.chat_session_sidebar_width")) || chat_session_sidebar_default_width);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem("downcity.chat_session_sidebar_width", String(width));
  }, []);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: chat_session_sidebar_min_width,
    max_width: chat_session_sidebar_max_width,
    default_width: chat_session_sidebar_default_width,
    on_width_change: handle_width_change,
  });
  return <motion.aside initial={false} animate={{ width: collapsed ? 0 : current_width }} transition={{ duration: is_resizing ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }} className={cn("relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-muted/45", !collapsed && "border-r border-border/35")}>
    <motion.div initial={false} animate={{ paddingLeft: get_chat_header_left_inset(controls?.sidebar_collapsed === true) }} transition={SHELL_PANEL_TRANSITION} className="flex h-10 shrink-0 items-center gap-2 pr-2" style={{ width: current_width }}>
      <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span><span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">{title}</span><SegmentedControl value={active_tab} options={[{ value: "chat", label: "Chat" }, { value: "config", label: config_label }]} on_value_change={(tab) => select_tab?.(tab)} aria_label="Left Panel 内容" />
    </motion.div>
    {!collapsed ? <div className="sidebar-body-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" style={{ width: current_width }}>{active_tab === "chat" ? <button type="button" disabled={create_disabled} aria-current={create_active ? "page" : undefined} onClick={create_session} className={cn("mb-1 flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-40", create_active ? "bg-primary/[0.1] text-foreground hover:bg-primary/[0.12]" : "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground")}><TbPlus className="size-3.5" /><span>新建对话</span></button> : null}{children}</div> : null}
    {!collapsed ? <div onMouseDown={handle_resize_start} className="absolute top-0 right-0 z-10 h-full w-1.5 -mr-[3px] cursor-ew-resize" /> : null}
  </motion.aside>;
}

/** Left Panel 中统一的配置导航项。 */
function ConfigNavigationItem({ icon, title, active, on_select }: { /** 配置图标。 */ icon: React.ReactNode; /** 配置标题。 */ title: string; /** 是否选中。 */ active: boolean; /** 打开配置。 */ on_select(): void }) {
  return <SessionListRow title={title} active={active} on_select={on_select} leading={icon} reserve_menu_space={false} />;
}
