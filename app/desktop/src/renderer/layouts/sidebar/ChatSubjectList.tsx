/** Chat Sidebar 的 Agent 与 Group 主体列表。 */

import { memo, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TbEdit, TbGhost3, TbLoader2, TbPlus, TbTrash } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { RowMenuButton } from "@/components/RowMenuButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_desktop_selector } from "@/app/use_desktop";
import { chat_row_status_description_key, resolve_chat_row_status, type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { is_group_phase_running, resolve_group_chat_live_status } from "@/features/chat/lib/group/group_runtime_projection";
import { get_agent_unread_attention, get_group_unread_attention } from "@/lib/notification/notification_state";
import { type ChatAttention } from "@/lib/notification/attention";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import type { ChatSubject } from "@/features/navigation/lib/chat_subject_order";
import { SidebarContent } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { sidebar_avatar_slot_class_name, sidebar_row_interaction_class_name } from "./sidebarRow";
import { SidebarRow, SidebarRowAction, SidebarRowLabel } from "./SidebarItem";
import { empty_conversations, SubjectConversationsPanel, type SubjectConversation } from "./SubjectConversationsPanel";
import { docked_visible_session_count, panel_mode_of, subject_card_panel_class_name, subject_item_docked_class_name, subject_item_floating_class_name, subject_row_class_name, subject_slot_class_name, type OpenPanels, type SubjectPanelMode } from "./subjectCard";
/** Chat 主体列表属性。 */
interface ChatSubjectListProps {
  /** Renderer 根控制器。 */
  controller: DesktopController;
  /** 当前选中的 Agent 标识。 */
  selected_agent_id: string;
  /** 当前选中的 Group 标识。 */
  selected_group_id: string;
  /** 当前 Workspace 标识。 */
  active_workspace_id: string;
  /** 按「最近一次对话」排序后的 Agent 与 Group 主体。 */
  subjects: ChatSubject[];
  /** 全部展开中的会话面板（至多一个浮动 + 任意多个嵌入）。 */
  open_panels: OpenPanels;
  /** 展开主体的会话列表，按主体 key 索引；由 ChatSidebar 仅为展开的那几个投影。没有展开时是共享空表。 */
  open_conversations: ReadonlyMap<string, readonly SubjectConversation[]>;
  /** 上报某主体的头像点击：推进折叠 / 浮动 / 嵌入的循环。引用恒定，行组件靠它保持 memo 有效。 */
  advance_panel(key: string): void;
  /** 显式设置某主体的展开方式；null 收起。引用恒定。 */
  set_panel_mode(key: string, mode: SubjectPanelMode | null): void;
  /** Session 目录是否已就绪；未就绪时顺序尚未确定，不渲染列表。 */
  hydrated: boolean;
  /** 可进入 Chat 的 Agent；主体列表用它绘制 Group 成员头像。 */
  agents: DesktopAgentSummary[];
  /** 新建 Session 可使用的 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** Catalog 是否仍在加载。 */
  loading: boolean;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 打开创建 Agent 页面。 */
  open_create_agent(): void;
  /** 打开 Group 配置。 */
  open_group_config(group_id: string): void;
}

/**
 * 渲染 Chat 主体列表及其空态。
 *
 * 开合状态与它的投影都在 ChatSidebar：那个投影必须知道展开了哪几个（只为它们建会话列表），
 * 而“浮动至多一个、嵌入可多个”也是列表级不变量，两者共用同一个信号。
 * 这里只负责分发与上报意图。
 *
 * 分发时只喂**展开了的那几行**真实数据，其余行拿共享空数组——避免用 `?? []` 现造，
 * 那会让行组件的 memo 每次渲染都失效（浅比较看到新数组）。
 */
export function ChatSubjectList(props: ChatSubjectListProps) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  return <SidebarContent class_name="space-y-0.5">
    {props.hydrated ? props.subjects.map((subject) => {
      // 每一行各自读出自己的展开方式；没展开的行一律 null，不会拿到别人展开到哪一步。
      const mode = panel_mode_of(props.open_panels, subject.key);
      // 共享常量而不是就地 `?? []`：行的 memo 靠引用比较，每帧新建数组会让全部行重渲染。
      const conversations = mode ? props.open_conversations.get(subject.key) ?? empty_conversations : empty_conversations;
      return subject.kind === "agent"
        ? <AgentSubject key={subject.key} agent={subject.agent} controller={props.controller} active={subject.agent.agent_id === props.selected_agent_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} unread_attention={get_agent_unread_attention(props.notification_state, subject.agent.agent_id)} subject_key={subject.key} mode={mode} conversations={conversations} advance_panel={props.advance_panel} set_panel_mode={props.set_panel_mode} />
        : <GroupSubject key={subject.key} group={subject.group} controller={props.controller} active={subject.group.group_id === props.selected_group_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} agents={props.agents} unread_attention={get_group_unread_attention(props.notification_state, subject.group.group_id)} open_group_config={props.open_group_config} subject_key={subject.key} mode={mode} conversations={conversations} advance_panel={props.advance_panel} set_panel_mode={props.set_panel_mode} />;
    }) : <SidebarEmptyState icon={<TbLoader2 className="animate-spin" />} title={translate_common("state.loading")} />}
    {props.hydrated && !props.loading && props.subjects.length === 0 ? <SidebarEmptyState
      icon={<TbGhost3 />}
      title={translate("sidebar.no_subjects")}
      action={<Button variant="primary" onClick={props.open_create_agent}>{translate("sidebar.new_agent")}</Button>}
    /> : null}
  </SidebarContent>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, active, active_workspace_id, workspaces, unread_attention, subject_key, conversations, mode, advance_panel, set_panel_mode }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Agent。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null; /** 该 Agent 的对话列表。 */ conversations: readonly SubjectConversation[]; /** 会话面板的展开方式；null 为折叠。 */ mode: SubjectPanelMode | null; /** 主体 key；与上面的回调拼成引用恒定的行回调。 */ subject_key: string; /** 头像点击：推进展开循环。 */ advance_panel(key: string): void; /** 显式设置展开方式。 */ set_panel_mode(key: string, mode: SubjectPanelMode | null): void }) {
  const translate = use_translation("navigation");
  // 引用恒定：把它直接交给行，行的 memo 才不会每次渲染都失效。
  const handle_advance = useCallback(() => advance_panel(subject_key), [advance_panel, subject_key]);
  const handle_open_change = useCallback((next: SubjectPanelMode | null) => set_panel_mode(subject_key, next), [set_panel_mode, subject_key]);
  // 字符串级订阅：只有该 Agent 的行状态变化时才重渲染，消息流 / runtime 的其它更新不触发。
  const live = use_desktop_selector(controller.stores.chat_stream, (state) => state.agent_chat_status[agent.agent_id] ?? null);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const status = resolve_chat_row_status(live, unread_attention);
  const new_chat = () => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); };
  return <ChatSubjectRow
    avatar={<AgentAvatar agent={agent} class_name="size-8" />}
    title={agent.name}
    // 空描述不再兜底成「暂无描述」：那句话会在新建几个 Agent 之后铺满整列，
    // 而行高随之退回单行档。真正需要用户知道的只有「这个 Agent 是什么」，
    // 而它没有描述时，静默比复述一遍「没有」更诚实。
    description={agent.description || undefined}
    active={Boolean(active)}
    status={status}
    mode={mode}
    on_advance={handle_advance}
    on_open_change={handle_open_change}
    conversations={conversations}
    on_new_chat={workspace_id ? new_chat : undefined}
    // 主体级操作：头像即入口。右侧留给会话列表的展开开关。
    subject_menu={(open_delete) => <>
      <DropdownMenuItem disabled={!workspace_id} onClick={new_chat}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem>
      <DropdownMenuItem onClick={() => controller.actions.select_agent(agent.agent_id)}><TbEdit /><span>{translate("sidebar.agent_settings")}</span></DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={open_delete}><TbTrash /><span>{translate("sidebar.permanent_delete")}</span></DropdownMenuItem>
    </>}
    subject_menu_open_label={translate("sidebar.subject_actions_for", { name: agent.name })}
    on_select={() => void controller.actions.open_agent_chat(agent.agent_id)}
    delete_confirm={{
      title: translate("sidebar.delete_agent_title", { name: agent.name }),
      description: translate("sidebar.delete_agent_description"),
      confirm_label: translate("sidebar.permanent_delete"),
      on_confirm: () => controller.actions.remove_agent(agent.agent_id),
    }}
  />;
});

/** 可直接进入聊天工作区的 Group 主体行。 */
const GroupSubject = memo(function GroupSubject({ group, controller, active, active_workspace_id, workspaces, agents, unread_attention, open_group_config, subject_key, conversations, mode, advance_panel, set_panel_mode }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Group。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 当前 Group 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null; /** 打开 Group 配置。 */ open_group_config(group_id: string): void; /** 该 Group 的对话列表。 */ conversations: readonly SubjectConversation[]; /** 会话面板的展开方式；null 为折叠。 */ mode: SubjectPanelMode | null; /** 主体 key；与上面的回调拼成引用恒定的行回调。 */ subject_key: string; /** 头像点击：推进展开循环。 */ advance_panel(key: string): void; /** 显式设置展开方式。 */ set_panel_mode(key: string, mode: SubjectPanelMode | null): void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const handle_advance = useCallback(() => advance_panel(subject_key), [advance_panel, subject_key]);
  const handle_open_change = useCallback((next: SubjectPanelMode | null) => set_panel_mode(subject_key, next), [set_panel_mode, subject_key]);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  // Group 的实时状态只在当前打开的 GroupSession 上产生，因此侧栏能区分「等成员响应」与「正在推进」；
  // 未打开时的等待与失败仍由未读通知表达。
  const has_pending_interaction = use_desktop_selector(controller.stores.chat_stream, (state) => (state.group_interactions_by_group[group.group_id]?.length ?? 0) > 0);
  const group_running = use_desktop_selector(controller.stores.chat_stream, (state) => is_group_phase_running(state.group_phase_by_group[group.group_id]));
  const status = resolve_chat_row_status(resolve_group_chat_live_status({ has_pending_interaction, running: group_running }), unread_attention);
  const new_chat = () => { if (workspace_id) void controller.actions.create_group_session(group.group_id, workspace_id); };
  return <ChatSubjectRow
    avatar={<GroupAvatar group={group} agents={agents} />}
    title={group.name}
    tag={translate("sidebar.members", { count: group.members.length })}
    description={group.instruction || undefined}
    active={active}
    status={status}
    mode={mode}
    on_advance={handle_advance}
    on_open_change={handle_open_change}
    conversations={conversations}
    on_new_chat={workspace_id ? new_chat : undefined}
    subject_menu={(open_delete) => <>
      <DropdownMenuItem disabled={!workspace_id} onClick={new_chat}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem>
      <DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>{translate("sidebar.group_settings")}</span></DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={open_delete}><TbTrash /><span>{common_translate("actions.delete")}</span></DropdownMenuItem>
    </>}
    subject_menu_open_label={translate("sidebar.subject_actions_for", { name: group.name })}
    on_select={() => void controller.actions.open_group(group.group_id)}
    delete_confirm={{
      title: translate("sidebar.delete_group_title", { name: group.name }),
      description: translate(active ? "sidebar.delete_active_group_description" : "sidebar.delete_group_description"),
      confirm_label: common_translate("actions.delete"),
      on_confirm: () => controller.actions.remove_group(group.group_id),
    }}
  />;
});

/**
 * Agent 与 Group 共用的主体行。三个入口从左到右职责固定：
 *
 * | 位置 | 入口 | 职责 |
 * |---|---|---|
 * | 左 | 头像 | 展开方式循环：折叠 → 浮动 → 嵌入 → 折叠 |
 * | 中 | 名称与描述 | 打开这个主体 |
 * | 右 | 状态图标 | 主体级操作（新建对话 / 配置 / 删除） |
 *
 * 头像与名称原本在同一个按钮里，头像因此不能单独成为入口——按钮不能嵌套按钮。
 * 改成两兄弟后中间的选择区反而更大了（名称 + 描述整块都可点）。
 *
 * ## 行高由「有没有描述」决定，不由瞬时状态决定
 *
 * 描述存在 → 双行 48；不存在 → 单行 44。**不按 `status_text` 决定**：
 * 那会让行在 Agent 开始回复的瞬间长高 4px、回复完再缩回去，
 * 一列主体随之上下滑动——用一次高度跳动去表达一次状态变化并不划算，
 * 状态本来就由右侧入口的图标、以及 Rail 上的未读点表达。
 */
function ChatSubjectRow({ avatar, title, tag, description, active, status, subject_menu, subject_menu_open_label, mode, on_advance, on_open_change, conversations, on_new_chat, on_select, delete_confirm }: {
  /** 主体头像，作为行首槽的内容与展开开关的触发器。 */
  avatar: ReactNode;
  /** 主体名称。 */
  title: string;
  /** 可选分类信息。 */
  tag?: string;
  /** 行描述；**为空时整个描述行不渲染**（行高也随之退回单行档）。 */
  description?: string;
  /** 是否为当前主体。 */
  active: boolean;
  /** 当前行状态。 */
  status: ChatRowStatus;
  /** 主体级操作项；删除项需要本组件闭合的确认流程，因此以回调形式接收打开删除的动作。 */
  subject_menu(open_delete: () => void): ReactNode;
  /** 主体级操作入口的可访问名称；带主体名，供读屏区分不同主体。 */
  subject_menu_open_label: string;
  /** 会话面板的展开方式；null 为折叠。 */
  mode: SubjectPanelMode | null;
  /** 头像点击：推进展开循环。 */
  on_advance(): void;
  /** 显式设置展开方式；null 收起。由列表层决定一次只能开一个，因此这里只上报意图。 */
  on_open_change(next: SubjectPanelMode | null): void;
  /** 该主体的会话。 */
  conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用。 */
  on_new_chat?(): void;
  /** 打开主体。 */
  on_select(): void;
  /** 删除确认的文案与执行入口；可见状态由本组件闭合。 */
  delete_confirm: { /** 标题。 */ title: string; /** 风险说明。 */ description: string; /** 确认按钮文案。 */ confirm_label: string; /** 执行删除。 */ on_confirm(): Promise<void> | void };
}) {
  const [delete_open, set_delete_open] = useState(false);
  return <>
    <ChatSubjectItem
      avatar={avatar}
      menu_label={subject_menu_open_label}
      menu={subject_menu(() => set_delete_open(true))}
      title={title}
      tag={tag}
      description={description}
      active={active}
      status={status}
      on_select={on_select}
      multi_line={Boolean(description)}
      mode={mode}
      on_advance={on_advance}
      on_open_change={on_open_change}
      // 会话数据直接往下传，由行自己渲染列表；不在此处拼一个节点再注入。
      conversations={conversations}
      on_new_chat={on_new_chat}
    />
    <SubjectDeleteDialog open={delete_open} set_open={set_delete_open} {...delete_confirm} />
  </>;
}

/** 主体删除前的确认 Dialog。 */
function SubjectDeleteDialog({ open, set_open, title, description, confirm_label, on_confirm }: { /** 是否可见。 */ open: boolean; /** 修改可见性。 */ set_open(open: boolean): void; /** 标题。 */ title: string; /** 风险说明。 */ description: string; /** 确认按钮文案。 */ confirm_label: string; /** 执行删除。 */ on_confirm(): Promise<void> | void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
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
  return <Dialog open={open} onOpenChange={(next_open) => { if (!pending) set_open(next_open); }}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogBody>{error ? <div className="text-xs text-destructive">{error}</div> : null}</DialogBody><DialogFooter><Button disabled={pending} onClick={() => set_open(false)}>{common_translate("actions.cancel")}</Button><Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? translate("sidebar.deleting") : confirm_label}</Button></DialogFooter></DialogContent></Dialog>;
}

/**
 * 头像开关下一动作的文案 key。
 *
 * 三种状态各说清**点下去会发生什么**，而不是当前是什么状态：
 * 折叠时说「展开」，浮动时说「固定到列表」（也就是下一个状态），嵌入时说「收起」。
 * 名称随状态变是可以的（它描述的是动作）；要靠 `aria-pressed` 表达状态的那类控件
 * 才必须保持名称稳定（见面板里的固定开关）。
 */
function subject_panel_trigger_label_key(mode: SubjectPanelMode | null): string {
  if (mode === null) return "sidebar.expand_sessions";
  return mode === "floating" ? "sidebar.dock_sessions" : "sidebar.collapse_sessions";
}

/** Agent 与 Group 共用的主体行；状态文案与动效由行状态唯一决定。 */
function ChatSubjectItem({ avatar, menu_label, menu, title, tag, description, active, status, on_select, multi_line, mode, on_advance, on_open_change, conversations, on_new_chat }: {
  /** 主体头像。 */ avatar: ReactNode;
  /** 头像入口的可访问名称。 */ menu_label: string;
  /** 主体级操作项。 */ menu: ReactNode;
  /** 主体名称。 */ title: string;
  /** 可选分类信息。 */ tag?: string;
  /** 行描述；为空时整个描述行不渲染。 */ description?: string;
  /** 是否为当前主体。 */ active: boolean;
  /** 当前行状态。 */ status: ChatRowStatus;
  /** 打开主体。 */ on_select(): void;
  /** 行高是否按双行档（= 有描述）。 */ multi_line: boolean;
  /** 会话面板的展开方式；null 为折叠。 */ mode: SubjectPanelMode | null;
  /** 头像点击：推进展开循环（折叠 → 浮动 → 嵌入 → 折叠）。 */ on_advance(): void;
  /** 显式设置展开方式；null 收起。 */ on_open_change(next: SubjectPanelMode | null): void;
  /** 该主体的会话。 */ conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用（例如还没有可用 Workspace）。 */ on_new_chat?(): void;
}) {
  const translate_chat = use_translation("chat");
  const translate_navigation = use_translation("navigation");
  const description_key = chat_row_status_description_key(status);
  const status_text = description_key ? translate_chat(description_key) : null;
  // 面板 id 用 useId：同一个列表里会有多行，写死的 id 会重复。
  const panel_id = useId();
  // 卡片元素：既是「点外部」判定的边界，也是浮动态的定位锚点。
  const card_ref = useRef<HTMLDivElement>(null);
  // 受控开合：状态在列表层，一次只能开一个。这里只把展开方式拆成两个可读的判定。
  const expanded = mode !== null;
  const pinned = mode === "docked";
  // 触发器文案要说清点下去会发生什么，因此三种状态各一句动词；
  // 行状态由 RowMenuButton 自动接在后面（如「…，需要你的响应」）。
  const trigger_label = translate_navigation(subject_panel_trigger_label_key(mode), { name: title });

  /**
   * 两个「退回」手势：点卡片外部、按 Esc。**只作用于浮动态**。
   *
   * 它们本来就是顺带动作：浮动会盖住它下面的行，所以默认就该“点开外部就收起”，
   * 否则用户想点被盖住的行，得先想办法把这个面板关掉。Esc 同理——它是“退回一步”，
   * 不是“撤销我的布置”。
   *
   * 嵌入态因此一个都不挂，而且不是因为“固定了所以把监听停掉”，是因为**前提不成立**：
   * 卡片已经在列表流里，没有盖住任何东西。这也顺带避掉一个真问题：多个嵌入面板各自
   * 持一份 document 监听时，一下 Esc 会把所有固定面板一起关掉。
   *
   * 用 `pointerdown` 而不是 `click`：按下的那一刻就能判定点在外部，不必等抬起，
   * 也不会出现「已经按到下面的行、抬起时才收起、结果那一下还被面板吃掉」的错位。
   *
   * 监听只挂在浮动的那一行。按另一个头像时也会先触发一次点外部，
   * 但 `set_open_panel_mode` 只在关闭的正是当前项时才清空（见 ChatSidebar），
   * 所以那一下会正确地变成“换一个开”。
   */
  useEffect(() => {
    if (mode !== "floating") return;
    const collapse = () => on_open_change(null);
    const handle_pointer_down = (event: PointerEvent) => {
      if (event.target instanceof Node && card_ref.current?.contains(event.target)) return;
      collapse();
    };
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      collapse();
    };
    document.addEventListener("pointerdown", handle_pointer_down);
    document.addEventListener("keydown", handle_key_down);
    return () => {
      document.removeEventListener("pointerdown", handle_pointer_down);
      document.removeEventListener("keydown", handle_key_down);
    };
  }, [mode, on_open_change]);

  /**
   * 选中会话 / 新建之后要把这面板收起吗——**看它是不是浮动**。
   *
   * 浮动收起来：它盖着正文，选完就该让位。
   * 嵌入不收：它是用户按了固定开关才得到的工作台，用一次就自动收起来等于把固定撤销了；
   * 多开几个时更是没法用——每选一条会话都要重新固定一次。
   *
   * 不传就是“不用收”（面板里写 `close?.()`），而不是传一个空函数：
   * “没有可执行的动作”比“有一个什么都不做的动作”更诚实。
   */
  const close_after_use = useCallback(() => on_open_change(null), [on_open_change]);

  /**
   * 嵌入后把卡片补进可视区。
   *
   * 嵌入会把卡片整个塞进列表流，而行本来就贴着列表底部时（列表比可视区长的常见情形），
   * 那一下点击看起来会像没反应：只有行本身变了形，列表一屏都动。
   *
   * 只补**底部溢出的那一点**滚动，而不是 `scrollIntoView`：后者在卡片比滚动区还高时会
   * 按“最近边”对齐，可能把整列主体一下翻上去，反而让人丢失了自己刚才在哪。
   * 滚动容器由 `SidebarContent` 的 `data-sidebar-scrollable` 标记，不必再加一层 ref 传递。
   */
  useEffect(() => {
    if (mode !== "docked") return;
    const card = card_ref.current;
    const scroller = card?.closest<HTMLElement>("[data-sidebar-scrollable]");
    if (!card || !scroller) return;
    const overflow = card.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (overflow > 0) scroller.scrollTop += overflow;
  }, [mode]);

  /**
   * 折叠态直接返回行本身，**不包槽位与卡片**。
   *
   * 这是绝大多数行的状态，因此它的 DOM 必须与普通列表行完全一致：
   * 多一层绝对定位 + overflow-hidden 的包裹，在几百行时是纯粹的布局开销。
   *
   * 展开时才搭出卡片；只有浮动需要额外一层槽位（见下）。
   */
  /**
   * 行内容：左侧头像（开关）、中间两行、右侧主体菜单。三种状态完全一致。
   *
   * 三个动作各占一处，各用各的元素，不再有位置争用：
   *
   * ```
   * [头像] 名称                        [⋯]   ← 头像 = 推进展开方式；名称 = 打开主体；⋯ = 主体操作
   *          描述                              ← 纯文字，不可点
   * ```
   *
   * 头像当开关的取舍：它是行内视觉上最明确的“物件”，不需要额外占一个图标位；
   * 代价是“点头像 = 展开列表”不自明，因此它带 `aria-expanded` / `aria-controls`、
   * 每次点击都会变的可访问名称（说清下一步会怎样）、以及悬停反馈
   * （与 GroupView 里的头像按钮同一套写法）。
   *
   * 这是侧栏里唯一一个**不能**交给 `SidebarItem` 的行：它的行首槽本身就是个开关
   * （推展开方式，带 `aria-expanded` / `aria-controls`），而 `SidebarItem` 的槽是装饰。
   * 其余部分（行底、标签区、操作位）仍走同一套组件。
   *
   * 头像的 32px 就是 `SIDEBAR_ROW_LEADING`：它自己就是行首槽，行的文字列由它决定。
   *
   * 描述行是**纯文字**：它本来只是说明，不是控件；
   * 把开关挂在一段说明上，读屏会把描述读成按钮名，反而听不出按钮要干什么。
   */
  const row_content = <>
    {/* 头像：推进展开方式（折叠 → 浮动 → 嵌入 → 折叠）。
        与 GroupView 的头像按钮同一套视觉（悬停降透明度 + focus-visible 环）：
        头像本身已含尺寸，因此不需要 Button 的 [&_svg] 覆盖。
        折叠时不给 `aria-controls`：它指向的那个面板还没在文档里，指向不存在的 id 是无效引用。 */}
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={expanded ? panel_id : undefined}
      onClick={on_advance}
      title={trigger_label}
      aria-label={trigger_label}
      className={cn(sidebar_avatar_slot_class_name, "rounded-control outline-none transition-opacity duration-150 hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/30")}
    >{avatar}</button>
    {/* 名称 + 描述：整块都是「打开主体」的入口。
        状态优先于描述：正在回复时，那句话比简介更该被看到；而**行高**只看有没有描述（见 ChatSubjectRow）。 */}
    <SidebarRowLabel
      title={title}
      tag={tag}
      current={active}
      description={status_text ? <StatusText status={status} text={status_text} /> : description}
      onSelect={on_select}
    />
    {/* 主体级操作菜单：行右端。图标仍由行状态决定：失败与完成不占用描述位，
        只靠这个图标表达，所以它不能换成通用的省略号。 */}
    <SidebarRowAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><RowMenuButton status={status} label={menu_label} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>{menu}</DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowAction>
  </>;
  /**
   * 行底底色：**展开态一律不给选中色**。
   *
   * 卡片已经铺了 `bg-background`，行内容再上一次选中底色，就会在一张卡内部切出一道色差
   * （上半灰、下半白），读起来又是两块。展开态不需要选中底色——“卡片开着”本身就是它在
   * 当前主体的证据；悬停反馈仍保留（瞬时反馈，且只落在行上、不会染到列表）。
   *
   * 折叠时保留选中底色：那是列表里一直以来的语言，也是用户判断“我在哪个 Agent”的依据。
   * 两者都取自行契约，因此行高、内边距与文字线不会跟别处分叉。
   */
  const row_active = !expanded && active;
  // 折叠：行自己就是那个边框盒（边框透明，与展开态同一份占位）。
  if (mode === null) return <SidebarRow variant="agent" active={row_active} multiLine={multi_line}>{row_content}</SidebarRow>;
  /**
   * 展开：同一个边框盒变成卡片，行内容与列表都住在里面。
   *
   * 两个展开态共用这段结构（也是同一份类名，见 subjectCard），区别只在定位：
   * 浮动相对槽位绝对定位，嵌入直接留在列表流里。因此外层包裹也是分开的——
   * 槽位只服务于浮动（它要占住那一行），嵌入时卡片自己就是那一行，多包一层只会多一层布局。
   */
  const card = (
    <div ref={card_ref} className={mode === "floating" ? subject_item_floating_class_name(multi_line) : subject_item_docked_class_name}>
      {/* 展开态的行内容：不带边框（那 1px 已经搬到卡片上），也不给选中底色（见 row_active）。 */}
      <div className={cn(subject_row_class_name(multi_line), sidebar_row_interaction_class_name(false))}>{row_content}</div>
      <div id={panel_id} className={subject_card_panel_class_name}>
        {/* 固定开关与展开方式是同一个信号：按下去 = 嵌入，抬起来 = 回到浮动。
            把这件事放在这里而不是面板内部，是因为面板只需要知道「现在固不固定」。

            条数上限只给嵌入：嵌入长期占位，条数必须有上限；浮动点外部就收，
            高度不是长期代价，多列几条不多占谁的位置（见 docked_visible_session_count）。 */}
        <SubjectConversationsPanel conversations={conversations} on_new_chat={on_new_chat} close={mode === "floating" ? close_after_use : undefined} max_visible={mode === "docked" ? docked_visible_session_count : undefined} pinned={pinned} on_toggle_pinned={(next) => on_open_change(next ? "docked" : "floating")} />
      </div>
    </div>
  );
  return mode === "floating" ? <div className={subject_slot_class_name(multi_line)}>{card}</div> : card;
}

/** 行状态文案；只有正在推进的状态附带循环动效，其余保持静态。 */
function StatusText({ status, text }: { /** 当前行状态。 */ status: ChatRowStatus; /** 已本地化的状态文案。 */ text: string }) {
  if (status !== "working") return <>{text}</>;
  return <span className="inline-flex min-w-0 whitespace-nowrap" aria-label={`${text}...`}>
    <span aria-hidden="true">{text}</span>
    <span aria-hidden="true" className="chat-replying-dots inline-flex w-[1.5em]">
      <span>.</span><span>.</span><span>.</span>
    </span>
  </span>;
}
