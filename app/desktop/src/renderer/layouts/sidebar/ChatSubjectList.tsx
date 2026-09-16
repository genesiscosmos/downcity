/** Chat Sidebar 的 Agent 与 Group 主体列表。 */

import { memo, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TbEdit, TbGhost3, TbPlus, TbTrash } from "react-icons/tb";
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
import { empty_conversations, SubjectConversationsPanel, type SubjectConversation } from "./SubjectConversationsPanel";
import { subject_card_panel_class_name, subject_item_collapsed_class_name, subject_item_expanded_class_name, subject_row_class_name, subject_slot_class_name } from "./subjectCard";

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
  /** 当前展开会话列表的主体 key；同一次只能有一个，因此是单个值而不是集合。 */
  open_subject_key: string | null;
  /** 展开主体的会话列表；由 ChatSidebar 只为它投影。未展开时是共享空数组。 */
  open_conversations: readonly SubjectConversation[];
  /** 上报某个主体的开合意图；引用恒定，行组件靠它保持 memo 有效。 */
  set_open(key: string, open: boolean): void;
  /** 是否保持展开（点外部不收起）。 */
  pinned: boolean;
  /** 切换保持展开；引用恒定。 */
  set_pinned(pinned: boolean): void;
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
 * 渲染 Chat 主体列表及其空状态。
 *
 * 开合状态与它的投影都在 ChatSidebar：那个投影必须知道展开的是谁（只为它建会话列表），
 * 而「一次只能开一个」也是列表级约束，两者共用同一个信号。这里只负责分发与上报意图。
 *
 * 分发时只喂**当前展开那一行**真实数据，其余行拿共享空数组——避免用 `?? []` 现造，
 * 那会让行组件的 memo 每次渲染都失效（浅比较看到新数组）。
 */
export function ChatSubjectList(props: ChatSubjectListProps) {
  const translate = use_translation("navigation");
  return <SidebarContent class_name="space-y-1">
    {props.hydrated ? props.subjects.map((subject) => {
      const expanded = subject.key === props.open_subject_key;
      // 共享常量而不是就地 `?? []`：行的 memo 靠引用比较，每帧新建数组会让全部行重渲染。
      const conversations = expanded ? props.open_conversations : empty_conversations;
      return subject.kind === "agent"
        ? <AgentSubject key={subject.key} agent={subject.agent} controller={props.controller} active={subject.agent.agent_id === props.selected_agent_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} unread_attention={get_agent_unread_attention(props.notification_state, subject.agent.agent_id)} subject_key={subject.key} expanded={expanded} conversations={conversations} set_open={props.set_open} pinned={props.pinned} set_pinned={props.set_pinned} />
        : <GroupSubject key={subject.key} group={subject.group} controller={props.controller} active={subject.group.group_id === props.selected_group_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} agents={props.agents} unread_attention={get_group_unread_attention(props.notification_state, subject.group.group_id)} open_group_config={props.open_group_config} subject_key={subject.key} expanded={expanded} conversations={conversations} set_open={props.set_open} pinned={props.pinned} set_pinned={props.set_pinned} />;
    }) : null}
    {props.hydrated && !props.loading && props.subjects.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{translate("sidebar.no_subjects")}</div><Button className="mt-3" variant="primary" onClick={props.open_create_agent}>{translate("sidebar.new_agent")}</Button></div> : null}
  </SidebarContent>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, active, active_workspace_id, workspaces, unread_attention, subject_key, conversations, expanded, set_open, pinned, set_pinned }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Agent。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null; /** 该 Agent 的对话列表。 */ conversations: readonly SubjectConversation[]; /** 会话浮层是否已打开。 */ expanded: boolean; /** 主体 key；与 set_open 拼成引用恒定的开合回调。 */ subject_key: string; /** 上报开合意图；引用恒定。 */ set_open(key: string, open: boolean): void; /** 是否保持展开。 */ pinned: boolean; /** 切换保持展开；引用恒定。 */ set_pinned(pinned: boolean): void }) {
  const translate = use_translation("navigation");
  // 引用恒定：把它直接交给行，行的 memo 才不会每次渲染都失效。
  const handle_open_change = useCallback((open: boolean) => set_open(subject_key, open), [set_open, subject_key]);
  // 字符串级订阅：只有该 Agent 的行状态变化时才重渲染，消息流 / runtime 的其它更新不触发。
  const live = use_desktop_selector(controller.stores.chat_stream, (state) => state.agent_chat_status[agent.agent_id] ?? null);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const status = resolve_chat_row_status(live, unread_attention);
  const new_chat = () => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); };
  return <ChatSubjectRow
    avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />}
    title={agent.name}
    description={agent.description || translate("sidebar.no_description")}
    active={Boolean(active)}
    status={status}
    expanded={expanded}
    on_open_change={handle_open_change}
    pinned={pinned}
    on_toggle_pinned={set_pinned}
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
const GroupSubject = memo(function GroupSubject({ group, controller, active, active_workspace_id, workspaces, agents, unread_attention, open_group_config, subject_key, conversations, expanded, set_open, pinned, set_pinned }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Group。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 当前 Group 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null; /** 打开 Group 配置。 */ open_group_config(group_id: string): void; /** 该 Group 的对话列表。 */ conversations: readonly SubjectConversation[]; /** 会话浮层是否已打开。 */ expanded: boolean; /** 主体 key；与 set_open 拼成引用恒定的开合回调。 */ subject_key: string; /** 上报开合意图；引用恒定。 */ set_open(key: string, open: boolean): void; /** 是否保持展开。 */ pinned: boolean; /** 切换保持展开；引用恒定。 */ set_pinned(pinned: boolean): void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const handle_open_change = useCallback((open: boolean) => set_open(subject_key, open), [set_open, subject_key]);
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
    description={group.instruction || translate("sidebar.no_description")}
    active={active}
    status={status}
    expanded={expanded}
    on_open_change={handle_open_change}
    pinned={pinned}
    on_toggle_pinned={set_pinned}
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
 * | 左 | 头像 | 主体级操作（新建对话 / 配置 / 删除） |
 * | 中 | 名称与描述 | 打开这个主体 |
 * | 右 | 状态图标 / 折角 | 弹出它的会话列表 |
 *
 * 头像与名称原本在同一个按钮里，头像因此不能单独成为入口——按钮不能嵌套按钮。
 * 改成两兄弟后中间的选择区反而更大了（名称 + 描述整块都可点）。
 */
function ChatSubjectRow({ avatar, title, tag, description, active, status, subject_menu, subject_menu_open_label, expanded, on_open_change, pinned, on_toggle_pinned, conversations, on_new_chat, on_select, delete_confirm }: {
  /** 主体头像，作为主体级操作菜单的触发器内容。 */
  avatar: ReactNode;
  /** 主体名称。 */
  title: string;
  /** 可选分类信息。 */
  tag?: string;
  /** 无状态时的行描述。 */
  description: string;
  /** 是否为当前主体。 */
  active: boolean;
  /** 当前行状态。 */
  status: ChatRowStatus;
  /** 主体级操作项；删除项需要本组件闭合的确认流程，因此以回调形式接收打开删除的动作。 */
  subject_menu(open_delete: () => void): ReactNode;
  /** 主体级操作入口的可访问名称；带主体名，供读屏区分不同主体。 */
  subject_menu_open_label: string;
  /** 会话浮层是否已展开。 */
  expanded: boolean;
  /** 浮层开合变化；由列表层决定一次只能开一个，因此这里只上报意图。 */
  on_open_change(open: boolean): void;
  /** 该主体的会话。 */
  conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用。 */
  on_new_chat?(): void;
  /** 是否保持展开（点外部不收起）。 */
  pinned: boolean;
  /** 切换保持展开。 */
  on_toggle_pinned(pinned: boolean): void;
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
      expanded={expanded}
      on_open_change={on_open_change}
      // 会话数据直接往下传，由行自己渲染列表；不在此处拼一个节点再注入。
      conversations={conversations}
      on_new_chat={on_new_chat}
      pinned={pinned}
      on_toggle_pinned={on_toggle_pinned}
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

/** Agent 与 Group 共用的主体行；状态文案与动效由行状态唯一决定。 */
function ChatSubjectItem({ avatar, menu_label, menu, title, tag, description, active, status, on_select, expanded, on_open_change, conversations, on_new_chat, pinned, on_toggle_pinned }: {
  /** 主体头像。 */
  avatar: ReactNode;
  /** 头像入口的可访问名称。 */
  menu_label: string;
  /** 主体级操作项。 */
  menu: ReactNode;
  /** 主体名称。 */
  title: string;
  /** 可选分类信息。 */
  tag?: string;
  /** 无状态时的行描述。 */
  description: ReactNode;
  /** 是否为当前主体。 */
  active: boolean;
  /** 当前行状态。 */
  status: ChatRowStatus;
  /** 打开主体。 */
  on_select(): void;
  /** 会话浮层是否已展开。 */
  expanded: boolean;
  /** 浮层开合变化。 */
  on_open_change(open: boolean): void;
  /** 该主体的会话。 */
  conversations: readonly SubjectConversation[];
  /** 新建对话；不提供时该项禁用（例如还没有可用 Workspace）。 */
  on_new_chat?(): void;
  /** 是否保持展开（点外部不收起）。 */
  pinned: boolean;
  /** 切换保持展开。 */
  on_toggle_pinned(pinned: boolean): void;
}) {
  const translate_chat = use_translation("chat");
  const translate_navigation = use_translation("navigation");
  const description_key = chat_row_status_description_key(status);
  const status_text = description_key ? translate_chat(description_key) : null;
  // 面板 id 用 useId：同一个列表里会有多行，写死的 id 会重复。
  const panel_id = useId();
  // 卡片元素：既是「点外部」判定的边界，也是展开态的定位锚点。
  const card_ref = useRef<HTMLDivElement>(null);
  // 受控开合：状态在列表层，一次只能开一个。
  // 触发器自身的开合文案要说清点下去会发生什么，展开态因此换一个动词；
  // 行状态由 RowMenuButton 自动接在后面（如「…，需要你的响应」）。
  const trigger_label = translate_navigation(expanded ? "sidebar.collapse_sessions" : "sidebar.expand_sessions", { name: title });

  /**
   * 点外部收起——面板的**默认**行为，由面板里的固定开关关掉。
   *
   * 面板会盖住它下面的行，所以默认就该「点开外部就收起」：否则用户想点被盖住的行，
   * 得先想办法把面板关掉——而面板本身没有明显的关闭按钮（只有一个折角）。
   *
   * 需要边看边操作（比如对照正文里的内容）时才用固定按钮把这个监听临时停掉。
   *
   * 用 `pointerdown` 而不是 `click`：按下的那一刻就能判定点在外部，不必等抬起，
   * 也不会出现「已经按到下面的行、抬起时才收起、结果那一下还被面板吃掉」的错位。
   *
   * 监听只挂在“展开且未固定”的那一行，因此它不会影响其它行。
   * 按另一个触发器时也会先触发一次点外部，但 `set_open` 只在关闭的正是当前项时才清空
   * （见 ChatSidebar），所以那一下会正确地变成“换一个开”。
   */
  useEffect(() => {
    if (!expanded || pinned) return;
    const handle_pointer_down = (event: PointerEvent) => {
      if (event.target instanceof Node && card_ref.current?.contains(event.target)) return;
      on_open_change(false);
    };
    document.addEventListener("pointerdown", handle_pointer_down);
    return () => document.removeEventListener("pointerdown", handle_pointer_down);
  }, [expanded, on_open_change, pinned]);

  /**
   * Esc 关闭：明确的关闭动作，因此不受固定影响。
   *
   * 也是键盘用户不必 Tab 回按钮的出口。
   */
  useEffect(() => {
    if (!expanded) return;
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      on_open_change(false);
    };
    document.addEventListener("keydown", handle_key_down);
    return () => document.removeEventListener("keydown", handle_key_down);
  }, [expanded, on_open_change]);

  /**
   * 折叠态直接返回行本身，**不包槽位与卡片**。
   *
   * 这是绝大多数行的状态，因此它的 DOM 必须与普通列表行完全一致：
   * 多一层绝对定位 + overflow-hidden 的包裹，在几百行时是纯粹的布局开销。
   * 展开时才搭出「槽位 + 卡片」——也只影响那一行。
   */
  /**
   * 行内容：左侧头像（开关）、中间两行、右侧主体菜单。两种状态完全一致。
   *
   * 三个动作各占一处，各用各的元素，不再有位置争用：
   *
   * ```
   * [头像] 名称                        [⋯]   ← 头像 = 展开/收起列表；名称 = 打开主体；⋯ = 主体操作
   *          描述                              ← 纯文字，不可点
   * ```
   *
   * 头像当开关的取舍：它是行内视觉上最明确的“物件”，不需要额外占一个图标位；
   * 代价是“点头像 = 展开列表”不自明，因此它带 `aria-expanded` / `aria-controls`
   * 与悬停反馈（与 GroupView 里的头像按钮同一套写法）。
   *
   * 描述行还原为**纯文字**：它本来只是说明，不是控件；
   * 把开关挂在一段说明上，读屏会把描述读成按钮名，反而听不出按钮要干什么。
   */
  const row_content = <>
    {/* 头像：展开 / 收起会话列表。
        与 GroupView 的头像按钮同一套视觉（悬停降透明度 + focus-visible 环）：
        头像本身已含尺寸，因此不需要 Button 的 [&_svg] 覆盖。 */}
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panel_id}
      onClick={() => on_open_change(!expanded)}
      title={trigger_label}
      aria-label={trigger_label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-opacity duration-150 hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/30"
    >{avatar}</button>
    {/* 名称 + 描述：整块都是「打开主体」的入口（沿用原本的实现）。
        描述不是独立控件，因此这里也没有第二个按钮——行的三个动作分别是
        头像（开关）、这一块（打开主体）、右端菜单（主体操作）。 */}
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={on_select}
      className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate text-xs font-medium text-foreground", tag ? "max-w-[55%] shrink" : "flex-1")}>{title}</span>
          {tag ? <span className="max-w-36 shrink truncate rounded-full bg-surface-subtle px-1.5 py-0.5 text-[0.5625rem] font-normal leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/item:opacity-100">{tag}</span> : null}
        </span>
        <span className={cn("mt-1 flex h-3.5 min-w-0 items-center truncate text-[0.625rem] leading-3.5", status_text ? "font-medium text-muted-foreground" : "text-muted-foreground")}>
          {status_text ? <StatusText status={status} text={status_text} /> : description}
        </span>
      </span>
    </button>
    {/* 主体级操作菜单：行右端。图标仍由行状态决定：失败与完成不占用描述位，
        只靠这个图标表达，所以它不能换成通用的省略号。 */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild><RowMenuButton status={status} label={menu_label} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>{menu}</DropdownMenuContent>
    </DropdownMenu>
  </>;
  /**
   * 行内容的交互底色。
   *
   * 展开时**不给底色**：卡片已经铺了 `bg-background`，行内容再上一次选中底色，
   * 就会在一张卡内部切出一道色差（上半灰、下半白），读起来又是两块。
   * 展开态不需要选中底色——“卡片开着”本身就是它在当前主体的证据；
   * 悬停反馈仍保留（它是瞬时反馈，且只落在行上、不会染到列表）。
   *
   * 折叠时保留选中底色：那是列表里一直以来的语言，也是用户判断“我在哪个 Agent”的依据。
   */
  const interaction_class_name = expanded
    ? "hover:bg-interaction-hover"
    : active ? "bg-interaction-selected hover:bg-interaction-active" : "hover:bg-interaction-hover";
  // 折叠：行自己就是边框盒（边框透明，占位与展开态一致）。
  if (!expanded) return <div className={cn(subject_item_collapsed_class_name, interaction_class_name)}>{row_content}</div>;
  // 展开：同一个边框盒变成卡片，行内容与列表都住在里面。
  return (
    <div className={subject_slot_class_name}>
      <div ref={card_ref} className={subject_item_expanded_class_name}>
        <div className={cn(subject_row_class_name, interaction_class_name)}>{row_content}</div>
        <div id={panel_id} className={subject_card_panel_class_name}>
          <SubjectConversationsPanel conversations={conversations} on_new_chat={on_new_chat} close={() => on_open_change(false)} pinned={pinned} on_toggle_pinned={on_toggle_pinned} />
        </div>
      </div>
    </div>
  );
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
