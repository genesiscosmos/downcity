/** 组合 Chat 主体导航与每个主体的会话入口。 */

import { memo, useCallback, useMemo, useState } from "react";
import { TbGhost3, TbPlus, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RowMenuButton } from "@/components/RowMenuButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { GroupSessionActionsMenu } from "@/features/chat/components/GroupSessionActionsMenu";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { use_desktop_selector } from "@/app/use_desktop";
import { get_group_session_unread_attention, get_session_unread_attention } from "@/lib/notification/notification_state";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { resolve_chat_row_status } from "@/features/chat/lib/chat_row_status";
import { resolve_chat_session_live_status } from "@/features/chat/lib/chat_runtime_projection";
import { select_agent_sessions } from "@/features/chat/lib/session_list_projection";
import { use_translation } from "@/locales/i18n";
import type { DesktopController, DesktopWorkspaceSession, NavigationTarget } from "@/types/DesktopView";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import type { DesktopAgentSummary, DesktopChatRuntime, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { ChatSubjectList } from "./ChatSubjectList";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPanel } from "./SidebarPanel";
import { advance_open_panels, no_open_panels, retain_open_panels, set_open_panel_mode, type OpenPanels, type SubjectPanelMode } from "./subjectCard";
import { empty_conversations_by_subject, type SubjectConversation } from "./SubjectConversationsPanel";
import { collect_agent_last_active, collect_group_last_active, merge_runtime_activity, order_chat_subjects, type ChatSubject } from "@/features/navigation/lib/chat_subject_order";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 打开创建 Agent 页面。 */
  open_create_agent(): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开 Group 配置。 */
  open_group_config(group_id: string): void;
}

/**
 * 投影一个主体的会话列表。
 *
 * ## 为什么要按需调用，而不是一次算出所有主体
 *
 * 早先这里把**每个主体**的会话列表连菜单一起建好，塞进一张 `subject.key → 列表` 的表。
 * 代价在依赖里：`selection` 一变（点一次会话就算变），全部主体都要重建——
 * N 个主体 × M 条会话的菜单元素、以及全量 Session 目录扫描，而**同时只有一个主体能看到**。
 *
 * 现在只在**展开的那一个**主体上调用它。折叠时一次都不调用，于是点会话、收到通知、
 * 流式运行态更新都不会再触发这份投影。
 *
 * 菜单仍在这里构造（面板不必认识 Session 目录与删除确认框），但只构造当前可见的那一份。
 */
function build_subject_conversations(options: {
  /** 目标是 Agent 还是 Group 主体。 */
  subject: ChatSubject;
  /** 全量 Session 目录。 */
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 实时运行态，用于逐条状态。 */
  chat_runtimes: Record<string, DesktopChatRuntime>;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 当前导航目标，用于标记当前项。 */
  selection: NavigationTarget | null;
  /** Renderer 根控制器。 */
  controller: DesktopController;
  /** 导航文案。 */
  translate(key: string, values?: Record<string, unknown>): string;
  /** 通用文案。 */
  translate_common(key: string, values?: Record<string, unknown>): string;
}): readonly SubjectConversation[] {
  const { subject, sessions_by_workspace, chat_runtimes, notification_state, selection, controller, translate, translate_common } = options;
  if (subject.kind === "group") {
    const group: DesktopGroupSummary = subject.group;
    return [...group.sessions]
      .sort((left, right) => right.updated_at - left.updated_at)
      .map((session) => {
        const status = resolve_chat_row_status(null, get_group_session_unread_attention(notification_state, group.group_id, session.session_id));
        return {
          key: session.session_id,
          title: session.title || translate("sidebar.new_chat"),
          active: selection?.kind === "group_session" && selection.session_id === session.session_id,
          status,
          select: () => void controller.actions.open_group(group.group_id, session.session_id),
          menu: <GroupSessionActionsMenu
            session={session}
            status={status}
            on_rename={(title) => controller.actions.rename_group_session(group.group_id, session.session_id, title)}
            on_remove={() => controller.actions.remove_group_session(group.group_id, session.session_id)}
          />,
        };
      });
  }
  const agent_id = subject.agent.agent_id;
  // 逐条状态与行上的规则一致（实时优先于未读），因此列表里那条「等待输入」和行上的提示不会矛盾。
  return select_agent_sessions(sessions_by_workspace, agent_id, (session_workspace_id, session) => {
    const runtime = chat_runtimes[get_session_key(session_workspace_id, agent_id, session.session_id)];
    // Runtime 是当前事实；尚未收到 Runtime 时回退到目录快照。
    return resolve_chat_session_live_status(runtime, session.executing);
  }).map(({ workspace_id, session, live_status }) => {
    const status = resolve_chat_row_status(live_status, get_session_unread_attention(notification_state, workspace_id, agent_id, session.session_id));
    return {
      key: `${workspace_id}:${session.session_id}`,
      title: session.title || translate("sidebar.new_chat"),
      active: selection?.kind === "session" && selection.session_id === session.session_id,
      status,
      select: () => void controller.actions.select_session(workspace_id, agent_id, session.session_id, true),
      menu: <SessionActionsMenu
        session={session}
        trigger={<RowMenuButton status={status} label={translate_common("actions.more")} />}
        on_rename={(title) => controller.actions.rename_session(workspace_id, agent_id, session.session_id, title)}
        on_archive={() => controller.actions.archive_session(workspace_id, agent_id, session.session_id)}
        on_remove={() => controller.actions.remove_session(workspace_id, agent_id, session.session_id)}
      />,
    };
  });
}

/**
 * 读取 Chat 目录状态，并组合主体列表。
 *
 * ## 会话列表的投影边界
 *
 * 会话列表需要三份数据（Session 目录、运行态、通知），这三份在这一层本来就已经订阅。
 * 行内各自订阅会让每一行都持有整张表，任何会话变化都要广播到所有行，所以投影留在这一层；
 * 但**只为展开的那几个主体**投影（见 `build_subject_conversations`）。
 *
 * ## 开合状态为什么在这里
 *
 * 行只上报意图、不自己持有状态（两行各记一个布尔值就会同时开着两张卡而列表层不知道），
 * 而投影又需要知道到底展开了哪几行。两件事共用同一个信号，因此它归这一层。
 *
 * 这也让**折叠态完全不做投影**：没有展开的面板时直接是共享空表，
 * 点会话、收到通知、流式更新都不会重建任何会话列表。
 *
 * ## 状态是「一个浮动 + 一组嵌入」，不是「一个 key」
 *
 * 以前这里只存一个 key，默认“一次只能开一个”。那个默认对**浮动**成立（它绝对定位、
 * 会盖住下面的行，两个同时存在必然互相遮挡），对**嵌入**却是错的：嵌入在列表流里各占
 * 一段，本来就该能并存。所以“只能一个”不是一条交互偏好，而是浮动态的物理后果，
 * 只作用在浮动那一侧。
 */
export const ChatSidebar = memo(function ChatSidebar({ controller, notification_state, open_create_agent, open_create_group, open_group_config }: ChatSidebarProps) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const hydrated = use_desktop_selector(controller.stores.session, (state) => state.hydrated);
  const chat_runtimes = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session);
  const selected_agent_id = selection && "agent_id" in selection ? selection.agent_id : "";
  const selected_group_id = selection && "group_id" in selection ? selection.group_id : "";
  // Agent 与 Group 共用一条「最近一次对话」时间轴；Agent 的时间还要用实时运行态补上 Session 目录之后的对话。
  const subjects = useMemo(() => order_chat_subjects({
    agents,
    groups,
    last_active_by_agent: merge_runtime_activity(collect_agent_last_active(sessions_by_workspace), chat_runtimes),
    last_active_by_group: collect_group_last_active(groups),
  }), [agents, chat_runtimes, groups, sessions_by_workspace]);

  /**
   * 展开中的会话面板：至多一个浮动 + 任意多个嵌入（理由见 subjectCard 里的 `OpenPanels`）。
   *
   * 「谁在展开」与「以什么方式展开」是同一个信号的两半，因此合成一个值而不是
   * 一个 key 加一个 `pinned` 布尔值：后者能表达出「没展开但已固定」这种不存在的组合，
   * 而且只能描述一个面板，嵌入态要的并存无从表达。
   */
  const [stored_panels, set_open_panels] = useState<OpenPanels>(no_open_panels);
  /**
   * 头像点击：推进这一个的展开循环（折叠 → 浮动 → 嵌入 → 折叠）。
   *
   * 引用恒定（`useCallback` 空依赖）：它要作为行组件的 prop，每次渲染新建会让行的 memo 全部失效。
   *
   * **完全不动别的面板**——嵌入态要的“独立”就是这一条。点开另一个时也只是把它推成浮动，
   * 而浮动至多一个（由 `set_open_panel_mode` 保证），已经嵌入的那几个原封不动。
   */
  const advance_panel = useCallback((key: string) => {
    set_open_panels((current) => advance_open_panels(current, key));
  }, []);
  /**
   * 把这个主体设成指定的展开方式；`null` 收起。
   *
   * 给「点外部 / Esc / 固定开关」这些**有明确目标**的动作。同样只动这一个。
   *
   * 对回调顺序不敏感：关闭事件可能来自「点外部」，而按下另一个头像时也会先触发一次
   * 点外部——彼时用户其实正在开新的那个，只在关闭的正是当前项时才清空，而不是一律置空。
   * （那段顺序无关的逻辑在 `set_open_panel_mode`，能独立验证。）
   */
  const set_panel_mode = useCallback((key: string, mode: SubjectPanelMode | null) => {
    set_open_panels((current) => set_open_panel_mode(current, key, mode));
  }, []);
  // 展开的主体可能已从列表消失（被删除、切换 Workspace）；此时视为未展开，
  // 避免它在同 key 的主体回来时「记得」之前是打开的。
  const open_panels = useMemo(
    () => retain_open_panels(stored_panels, subjects.map((subject) => subject.key)),
    [stored_panels, subjects],
  );

  /** 展开中的那几个主体 key；投影只认这几个。 */
  const open_subject_keys = useMemo(
    () => [
      ...(open_panels.floating_key === null ? [] : [open_panels.floating_key]),
      ...open_panels.docked_keys,
    ],
    [open_panels],
  );

  // 只为展开的那几个主体投影；没有展开就没有任何扫描。
  const open_conversations = useMemo(() => {
    if (open_subject_keys.length === 0) return empty_conversations_by_subject;
    const by_subject = new Map<string, readonly SubjectConversation[]>();
    for (const key of open_subject_keys) {
      const subject = subjects.find((item) => item.key === key);
      if (!subject) continue;
      by_subject.set(key, build_subject_conversations({
        subject,
        sessions_by_workspace,
        chat_runtimes,
        notification_state,
        selection,
        controller,
        translate,
        translate_common,
      }));
    }
    return by_subject;
  }, [chat_runtimes, controller, notification_state, open_subject_keys, selection, sessions_by_workspace, subjects, translate, translate_common]);

  return <SidebarPanel>
    <SidebarHeader title={translate("views.chat")} actions={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title={translate("sidebar.add_chat_subject")} aria-label={translate("sidebar.add_chat_subject")}><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_create_agent}><TbGhost3 /><span>{translate("sidebar.new_agent")}</span></DropdownMenuItem><DropdownMenuItem onClick={open_create_group}><TbUsers /><span>{translate("sidebar.new_group")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />
    <ChatSubjectList controller={controller} subjects={subjects} open_panels={open_panels} open_conversations={open_conversations} advance_panel={advance_panel} set_panel_mode={set_panel_mode} hydrated={hydrated} selected_agent_id={selected_agent_id} selected_group_id={selected_group_id} active_workspace_id={active_workspace_id} agents={agents} workspaces={workspaces} loading={loading} notification_state={notification_state} open_create_agent={open_create_agent} open_group_config={open_group_config} />
  </SidebarPanel>;
});
