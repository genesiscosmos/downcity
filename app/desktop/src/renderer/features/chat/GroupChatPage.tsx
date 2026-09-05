/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback, useMemo } from "react";

import type { RespondSessionInteractionInput } from "@downcity/agent";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { GroupView } from "@/features/group/GroupView";
import { GroupComposer } from "@/features/chat/composer/GroupComposer";

import { GroupChatMainView } from "@/features/group/components/GroupChatDetails";
import { empty_items } from "@/features/chat/lib/chat_view_defaults";

/** Group Chat 路由只订阅其直接依赖的 Group、Agent、Workspace 与 Chat 设置。 */
export function GroupChatRouteMainView({ selection, controller, sidebar_collapsed }: { /** Group Chat 导航目标。 */ selection: Extract<NavigationTarget, { kind: "group_session" | "group_draft" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const group = use_desktop_selector(controller.stores.catalog, (state) => state.groups_by_id[selection.group_id]);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
  const session = selection.kind === "group_draft"
    ? { session_id, title: "新对话", workspace_id: selection.workspace_id, created_at: 0, updated_at: 0, message_count: 0 }
    : group?.sessions.find((item) => item.session_id === session_id);
  if (!group || !session) return <WelcomeView />;
  return <GroupChatMainView group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} view_key={`group-chat:${group.group_id}:${session_id}`}>
    {(open_group_info) => <GroupChatSurface selection={selection} group={group} session={session} open_group_info={open_group_info} workspaces={workspaces} agents={agents} settings={settings} controller={controller} />}
  </GroupChatMainView>;
}

/** Group Chat 的消息、状态和草稿消费边界。 */
export function GroupChatSurface({ selection, group, session, open_group_info, workspaces, agents, settings, controller }: { /** 当前 Group Chat 导航目标。 */ selection: Extract<NavigationTarget, { kind: "group_session" | "group_draft" }>; /** 当前 Group。 */ group: DesktopGroupSummary; /** 当前 Group Session 摘要。 */ session: DesktopGroupSummary["sessions"][number]; /** 打开 Group 编辑侧栏。 */ open_group_info(): void; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
  const group_id = selection.group_id;
  const workspace_id = selection.workspace_id;
  const message_projection = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_message_projection_by_group[group_id]);
  const member_statuses = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_member_statuses_by_group[group_id]);
  const group_phase = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_phase_by_group[group_id]);
  const interactions = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_interactions_by_group[group_id]);
  const switch_workspace = useCallback((target_workspace_id: string) => selection.kind === "group_draft" ? controller.actions.switch_group_draft_context(group_id, target_workspace_id) : controller.actions.create_group_session(group_id, target_workspace_id), [controller.actions, group_id, selection.kind]);
  const respond_interaction = useCallback((input: RespondSessionInteractionInput) => selection.kind === "group_session" ? controller.actions.respond_group_interaction(group_id, selection.session_id, input) : Promise.resolve(), [controller.actions, group_id, selection]);
  const remove_session = useMemo(() => selection.kind === "group_session" ? () => controller.actions.remove_group_session(group_id, selection.session_id) : undefined, [controller.actions, group_id, selection]);
  return <GroupView
    group={group}
    open_group_info={open_group_info}
    workspace_id={workspace_id}
    workspaces={workspaces}
    workspace_draft_mode={selection.kind === "group_draft"}
    switch_workspace={switch_workspace}
    session={session}
    agents={agents}
    settings={settings}
    message_projection={selection.kind === "group_draft" ? undefined : message_projection}
    member_statuses={member_statuses ?? empty_items}
    group_phase={group_phase ?? "idle"}
    interactions={interactions ?? empty_items}
    respond_interaction={respond_interaction}
    composer={<GroupComposer selection={selection} stores={controller.stores} actions={controller.actions} />}
    remove_session={remove_session}
  />;
}
