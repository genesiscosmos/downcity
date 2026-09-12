/** Chat Sidebar 底部的当前主体 Session 面板。 */

import { useEffect, useMemo, useRef, useState } from "react";
import { TbChevronDown, TbChevronUp, TbPlus } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { GroupSessionActionsMenu } from "@/features/chat/components/GroupSessionActionsMenu";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { select_agent_sessions } from "@/features/chat/lib/session_list_projection";
import { get_group_session_unread_attention, get_session_unread_attention } from "@/lib/notification/notification_state";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import { is_chat_busy, type DesktopController, type NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SessionListItem, SessionListRow } from "./SessionListItem";
import { SidebarContent } from "./SidebarPanel";

/** 当前主体 Session 面板属性。 */
interface ChatSessionPanelProps {
  /** Renderer 根控制器。 */
  controller: DesktopController;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 当前导航目标。 */
  selection: NavigationTarget | null;
  /** 当前选中的 Agent。 */
  selected_agent?: DesktopAgentSummary;
  /** 当前选中的 Group。 */
  selected_group?: DesktopGroupSummary;
  /** 新建 Session 使用的 Workspace。 */
  workspace_id?: string;
}

/** 持有 Session 列表、折叠、垂直调整尺寸及其本地持久化。 */
export function ChatSessionPanel({ controller, notification_state, selection, selected_agent, selected_group, workspace_id }: ChatSessionPanelProps) {
  const translate = use_translation("navigation");
  const [collapsed, set_collapsed] = useState(() => localStorage.getItem("downcity.chat_sessions_collapsed") === "true");
  const [height, set_height] = useState(() => Number(localStorage.getItem("downcity.chat_sessions_height")) || 240);
  const [resizing, set_resizing] = useState(false);
  const panel_ref = useRef<HTMLElement | null>(null);
  const resize_start_y_ref = useRef(0);
  const resize_start_height_ref = useRef(0);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const chat_runtimes = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session);
  const agent_sessions = useMemo(() => {
    const agent_id = selected_agent?.agent_id ?? "";
    return select_agent_sessions(sessions_by_workspace, agent_id, (session_workspace_id, session) => {
      const runtime = chat_runtimes[get_session_key(session_workspace_id, agent_id, session.session_id)];
      // Runtime 是当前事实；尚未收到 Runtime 时回退到目录快照。
      return runtime ? is_chat_busy(runtime) : session.executing;
    });
  }, [chat_runtimes, selected_agent?.agent_id, sessions_by_workspace]);
  const group_sessions = useMemo(
    () => selected_group ? [...selected_group.sessions].sort((left, right) => right.updated_at - left.updated_at) : [],
    [selected_group],
  );

  const toggle_collapsed = () => set_collapsed((current) => {
    localStorage.setItem("downcity.chat_sessions_collapsed", String(!current));
    return !current;
  });
  const start_resize = (event: React.MouseEvent) => {
    if (event.button !== 0 || collapsed) return;
    event.preventDefault();
    resize_start_y_ref.current = event.clientY;
    resize_start_height_ref.current = height;
    set_resizing(true);
  };

  useEffect(() => {
    if (!resizing) return;
    const previous_cursor = document.body.style.cursor;
    const previous_user_select = document.body.style.userSelect;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const handle_mouse_move = (event: MouseEvent) => {
      const available_height = panel_ref.current?.parentElement?.clientHeight ?? window.innerHeight;
      const next_height = resize_start_height_ref.current + resize_start_y_ref.current - event.clientY;
      set_height(Math.max(120, Math.min(available_height - 160, next_height)));
    };
    const handle_mouse_up = () => {
      set_resizing(false);
      set_height((current) => {
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
  }, [resizing]);

  const subject_name = selected_agent?.name ?? selected_group?.name;
  if (!subject_name) return null;
  const empty = selected_agent ? agent_sessions.length === 0 : group_sessions.length === 0;
  return <section ref={panel_ref} aria-label={translate("sidebar.sessions_for", { name: subject_name })} className="relative mx-2 mb-2 flex shrink-0 flex-col overflow-hidden rounded-xl bg-surface-subtle" style={collapsed ? undefined : { height }}>
    {!collapsed ? <div role="separator" aria-orientation="horizontal" aria-label={translate("sidebar.resize_sessions")} onMouseDown={start_resize} className="group absolute -top-1.5 left-0 z-10 flex h-3 w-full cursor-ns-resize items-center justify-center"><span className="h-px w-8 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground/25" /></div> : null}
    <div className="flex h-9 shrink-0 items-center gap-2 px-2">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-expanded={!collapsed} onClick={toggle_collapsed}>{collapsed ? <TbChevronUp className="size-3.5" /> : <TbChevronDown className="size-3.5" />}<span className="truncate">{translate("sidebar.sessions_for", { name: subject_name })}</span></button>
      <Button size="icon" title={translate("sidebar.new_chat")} aria-label={translate("sidebar.new_chat")} disabled={!workspace_id} onClick={() => { if (!workspace_id) return; if (selected_agent) void controller.actions.create_session(workspace_id, selected_agent.agent_id); else if (selected_group) void controller.actions.create_group_session(selected_group.group_id, workspace_id); }}><TbPlus /></Button>
    </div>
    {!collapsed ? <SidebarContent class_name="space-y-0.5 px-1.5 pb-1.5">
      {selected_agent ? agent_sessions.map(({ workspace_id: session_workspace_id, session, executing }) => <SessionListItem key={`${session_workspace_id}:${session.session_id}`} session={session} executing={executing} active={selection?.kind === "session" && selection.session_id === session.session_id} unread_attention={get_session_unread_attention(notification_state, session_workspace_id, selected_agent.agent_id, session.session_id)} on_select={() => void controller.actions.select_session(session_workspace_id, selected_agent.agent_id, session.session_id, true)} on_rename={(title) => controller.actions.rename_session(session_workspace_id, selected_agent.agent_id, session.session_id, title)} on_archive={() => controller.actions.archive_session(session_workspace_id, selected_agent.agent_id, session.session_id)} on_remove={() => controller.actions.remove_session(session_workspace_id, selected_agent.agent_id, session.session_id)} />) : null}
      {selected_group ? group_sessions.map((session) => <SessionListRow key={session.session_id} title={session.title || translate("sidebar.new_chat")} active={selection?.kind === "group_session" && selection.session_id === session.session_id} on_select={() => void controller.actions.open_group(selected_group.group_id, session.session_id)} menu={<GroupSessionActionsMenu session={session} unread_attention={get_group_session_unread_attention(notification_state, selected_group.group_id, session.session_id)} on_rename={(title) => controller.actions.rename_group_session(selected_group.group_id, session.session_id, title)} on_remove={() => controller.actions.remove_group_session(selected_group.group_id, session.session_id)} />} />) : null}
      {empty ? <div className="px-2 py-5 text-center text-[10px] text-muted-foreground/55">{translate("sidebar.no_sessions")}</div> : null}
    </SidebarContent> : null}
  </section>;
}
