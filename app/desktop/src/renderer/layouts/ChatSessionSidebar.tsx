/** 当前聊天主体拥有的可折叠、可调整宽度 Session 内部侧边栏。 */

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TbMessageCircle, TbPlus, TbTrash } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { SessionListItem } from "./sidebar/SessionListItem";

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
}

/** 展示当前 Agent 跨 Workspace 的全部 Session。 */
export function AgentChatSessionSidebar({ agent, controller, collapsed, toggle_collapsed }: AgentChatSessionSidebarProps) {
  const sessions = Object.entries(controller.sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries.filter((entry) => entry.agent_id === agent.agent_id).map((entry) => ({ workspace_id, session: entry.session })))
    .sort((left, right) => Number(right.session.executing) - Number(left.session.executing) || right.session.updated_at - left.session.updated_at);
  const workspace_id = controller.active_workspace_id || controller.workspaces[0]?.workspace_id;
  return <ChatSessionSidebarFrame collapsed={collapsed} title={agent.agent_id} avatar={<AgentAvatar agent={agent} class_name="size-5 rounded-md" />} create_session={() => { if (workspace_id) void controller.create_session(workspace_id, agent.agent_id); }} create_disabled={!workspace_id}>
    {controller.selection?.kind === "draft" && controller.selection.agent_id === agent.agent_id ? <DraftSessionItem active /> : null}
    {sessions.map(({ workspace_id: session_workspace_id, session }) => <SessionListItem key={`${session_workspace_id}:${session.session_id}`} session={session} active={controller.selection?.kind === "session" && controller.selection.agent_id === agent.agent_id && controller.selection.session_id === session.session_id} on_select={() => void controller.select_session(session_workspace_id, agent.agent_id, session.session_id, true)} on_rename={(title) => controller.rename_session(session_workspace_id, agent.agent_id, session.session_id, title)} on_archive={() => controller.archive_session(session_workspace_id, agent.agent_id, session.session_id)} on_remove={() => controller.remove_session(session_workspace_id, agent.agent_id, session.session_id)} />)}
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
}

/** 展示当前 Group 的全部 GroupSession。 */
export function GroupChatSessionSidebar({ group, controller, collapsed }: GroupChatSessionSidebarProps) {
  const sessions = [...group.sessions].sort((left, right) => right.updated_at - left.updated_at);
  return <ChatSessionSidebarFrame collapsed={collapsed} title={group.name} avatar={<TbMessageCircle className="size-4 text-muted-foreground" />} create_session={() => void controller.create_group_session(group.group_id, controller.active_workspace_id || undefined)}>
    {sessions.map((session) => <div key={session.session_id} role="button" tabIndex={0} className={cn("group flex min-h-7 cursor-pointer items-center gap-1 rounded-lg p-0.5 pl-2 text-xs transition-colors", controller.selection?.kind === "group_session" && controller.selection.group_id === group.group_id && controller.selection.session_id === session.session_id ? "bg-primary/[0.1]" : "hover:bg-foreground/[0.07]")} onClick={() => void controller.open_group(group.group_id, session.session_id)}><span className="min-w-0 flex-1 truncate">{session.preview_text || "新对话"}</span><Button size="icon" className="opacity-0 group-hover:opacity-100" title="删除对话" aria-label="删除对话" onClick={(event) => { event.stopPropagation(); void controller.remove_group_session(group.group_id, session.session_id); }}><TbTrash /></Button></div>)}
  </ChatSessionSidebarFrame>;
}

/** 内部 Session 导航的固定布局。 */
function ChatSessionSidebarFrame({ collapsed, title, avatar, create_session, create_disabled = false, children }: { /** 是否完全折叠。 */ collapsed: boolean; /** 主体名称。 */ title: string; /** 主体头像。 */ avatar: React.ReactNode; /** 创建 Session。 */ create_session(): void; /** 是否禁止创建。 */ create_disabled?: boolean; /** Session 项。 */ children: React.ReactNode }) {
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
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/35 pr-2 pl-10" style={{ width: current_width }}>
      <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span><span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">{title}</span><Button size="icon" title="新对话" aria-label="新对话" disabled={create_disabled} onClick={create_session}><TbPlus /></Button>
    </div>
    {!collapsed ? <div className="sidebar-body-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" style={{ width: current_width }}>{children}</div> : null}
    {!collapsed ? <div onMouseDown={handle_resize_start} className="absolute top-0 right-0 z-10 h-full w-1.5 -mr-[3px] cursor-ew-resize" /> : null}
  </motion.aside>;
}

/** 尚未持久化的新对话导航项。 */
function DraftSessionItem({ active }: { /** 是否选中。 */ active: boolean }) { return <div className={cn("flex min-h-7 items-center gap-1 rounded-lg px-2 text-xs", active && "bg-primary/[0.1]")}><TbMessageCircle className="size-3.5 text-muted-foreground" /><span>新对话</span></div>; }
