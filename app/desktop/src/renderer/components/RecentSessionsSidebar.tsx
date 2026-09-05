/** Desktop 全局最近 Session 侧栏，统一展示 Agent 与 Group 的最近对话。 */

import { useMemo } from "react";
import { TbMessageCircle, TbUsers } from "react-icons/tb";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController } from "@/types/DesktopView";
import { use_translation } from "@/locales/i18n";

interface RecentSessionsSidebarProps {
  /** Desktop 根状态控制器。 */
  controller: DesktopController;
  /** 关闭侧栏。 */
  close_sidebar(): void;
  /** 是否嵌入 BayBar。 */
  embedded?: boolean;
}

/** 展示全局最近更新的 Session，并提供直接导航。 */
export function RecentSessionsSidebar({ controller, close_sidebar, embedded = false }: RecentSessionsSidebarProps) {
  const translate_chat = use_translation("chat");
  const translate_navigation = use_translation("navigation");
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const entries = useMemo(() => [
    ...Object.entries(sessions_by_workspace).flatMap(([workspace_id, sessions]) => sessions.map(({ agent_id, session }) => ({ kind: "agent" as const, workspace_id, agent_id, session_id: session.session_id, title: session.title || translate_chat("conversation.new"), preview: session.preview_text, updated_at: session.updated_at }))),
    ...groups.flatMap((group) => group.sessions.filter((session) => session.workspace_id).map((session) => ({ kind: "group" as const, group_id: group.group_id, group_name: group.name, workspace_id: session.workspace_id!, session_id: session.session_id, title: session.title || translate_chat("conversation.new"), preview: session.preview_text, updated_at: session.updated_at }))),
  ].sort((left, right) => right.updated_at - left.updated_at).slice(0, 30), [groups, sessions_by_workspace, translate_chat]);
  return <DetailEditorSidebar title={translate_navigation("sidebar.recent")} storage_key="downcity.recent_sessions_width" default_width={360} max_width={520} on_close={close_sidebar} show_close embedded={embedded}>
    <div className="-mx-3 divide-y divide-border/45 border-y border-border/45">
      {entries.map((entry) => <button key={`${entry.kind}:${entry.workspace_id}:${entry.session_id}`} type="button" className="flex min-h-12 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-interaction-hover" onClick={() => { close_sidebar(); if (entry.kind === "agent") void controller.actions.select_session(entry.workspace_id, entry.agent_id, entry.session_id); else void controller.actions.open_group(entry.group_id, entry.session_id); }}>
        {entry.kind === "agent" ? <TbMessageCircle className="size-4 shrink-0 text-muted-foreground" /> : <TbUsers className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{entry.title}</span><span className="block truncate text-[10px] text-muted-foreground">{entry.kind === "agent" ? agents.find((agent) => agent.agent_id === entry.agent_id)?.name || "Agent" : entry.group_name}{entry.preview && entry.title !== entry.preview ? ` · ${entry.preview}` : ""}</span></span>
      </button>)}
      {entries.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground">{translate_navigation("panels.recent_empty")}</div> : null}
    </div>
  </DetailEditorSidebar>;
}
