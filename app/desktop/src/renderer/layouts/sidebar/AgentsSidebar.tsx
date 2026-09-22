/**
 * Agents 侧栏：Agent 与 Group 的列表。
 *
 * ## 这一层只回答「有哪些 Agent」
 *
 * 会话的入口在 Works 侧栏（会话住在 Workspace 里），因此这里不再列会话，也不再有展开卡片。
 * 行只做两件事：说明这个主体是谁，以及点它去哪里。
 *
 * ```text
 * [头像 32] 名称 / 描述            ⋯    点击行 → Agent profile / Group 配置；⋯ → 主体操作
 * ```
 *
 * 这样切分之后，同一个会话只有一个入口，未读状态也只有一个地方汇总；而 Agent 列表回到
 * 它本该回答的问题上——「我有哪些 Agent」，而不是「它们各自聊过什么」。
 *
 * ## 为什么 Agent 与 Group 仍在同一个列表
 *
 * 两者都是「可以对话的主体」，用户找它们时想的是同一个问题。分成两段会让人在两个折叠区之间
 * 来回找，而按最近活跃混排能让「刚刚聊过的那个」总是排在最前——这比分类更接近真实用法。
 *
 * ## 行高由「有没有描述」决定，不由瞬时状态决定
 *
 * 描述存在 → 双行 48；不存在 → 单行 44。**不按运行状态决定**：那会让行在 Agent 开始回复的
 * 瞬间长高 4px、回复完再缩回去，一列主体随之上下滑动——用一次高度跳动去表达一次状态变化
 * 并不划算，状态本来就由右侧入口的图标、以及 Rail 上的未读点表达。
 *
 * ## 投影边界
 *
 * 最近活跃排序需要 Session 目录与运行态两份整表，因此订阅留在这一层，行只收数据。
 * 行内各自订阅会让每一行都持有整张表，任何会话变化都要广播到所有行。
 */

import { memo, useMemo, useState } from "react";
import { TbEdit, TbGhost3, TbPlus, TbTrash, TbUsers } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { RowMenuButton } from "@/components/RowMenuButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_desktop_selector } from "@/app/use_desktop";
import { resolve_chat_row_status } from "@/features/chat/lib/chat_row_status";
import { is_group_phase_running, resolve_group_chat_live_status } from "@/features/chat/lib/group/group_runtime_projection";
import { collect_agent_last_active, collect_group_last_active, merge_runtime_activity, order_chat_subjects, type ChatSubject } from "@/features/navigation/lib/chat_subject_order";
import { get_agent_unread_attention, get_group_unread_attention } from "@/lib/notification/notification_state";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarItem } from "./SidebarItem";

/** Agents 侧栏属性。 */
interface AgentsSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 打开创建 Agent 页面。 */
  open_create_agent(): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开 Group 配置页。 */
  open_group_config(group_id: string): void;
}

/**
 * 读取 Catalog 与运行态，渲染 Agent / Group 列表。
 *
 * 排序用的是 Agent 与 Group 共用的一条「最近一次对话」时间轴（`order_chat_subjects`）：
 * 刚聊完的那个排在最前，与它在哪个 Workspace 无关。
 */
export const AgentsSidebar = memo(function AgentsSidebar({ controller, open_create_agent, open_create_group, open_group_config }: AgentsSidebarProps) {
  const translate = use_translation("navigation");
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const hydrated = use_desktop_selector(controller.stores.session, (state) => state.hydrated);
  const chat_runtimes = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session);
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const selected_agent_id = selection && "agent_id" in selection ? selection.agent_id : "";
  const selected_group_id = selection && "group_id" in selection ? selection.group_id : "";
  // Agent 与 Group 共用一条「最近一次对话」时间轴；Agent 的时间还要用实时运行态补上
  // Session 目录之后的对话。整份投影放 useMemo：它要遍历全量目录，不能每次渲染重算。
  const subjects = useMemo(() => order_chat_subjects({
    agents,
    groups,
    last_active_by_agent: merge_runtime_activity(collect_agent_last_active(sessions_by_workspace), chat_runtimes),
    last_active_by_group: collect_group_last_active(groups),
  }), [agents, chat_runtimes, groups, sessions_by_workspace]);

  // 必须包在 `SidebarPanel` 里：`SidebarFrame` 的 children 容器是**横向** flex
  //（Rail 与 Panel 并排），裸着返回会让 Header 与列表成为它的两个 flex 项，变成左右布局。
  return <SidebarPanel>
    <SidebarHeader title={translate("views.agent")} actions={
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" title={translate("sidebar.add_chat_subject")} aria-label={translate("sidebar.add_chat_subject")}><TbPlus /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={open_create_agent}><TbGhost3 /><span>{translate("sidebar.new_agent")}</span></DropdownMenuItem>
          <DropdownMenuItem onClick={open_create_group}><TbUsers /><span>{translate("sidebar.new_group")}</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    } />
    <SidebarContent class_name="space-y-0.5">
      {/* 目录未就绪时不渲染列表：那时候顺序还没确定，先摆一个空列表等于把「还没读到」说成「没有」。 */}
      {hydrated ? subjects.map((subject) => subject.kind === "agent"
        ? <AgentSubject key={subject.key} agent={subject.agent} controller={controller} active={subject.agent.agent_id === selected_agent_id} unread_attention={get_agent_unread_attention(notification_state, subject.agent.agent_id)} />
        : <GroupSubject key={subject.key} group={subject.group} controller={controller} agents={agents} active={subject.group.group_id === selected_group_id} unread_attention={get_group_unread_attention(notification_state, subject.group.group_id)} open_group_config={open_group_config} />)
        : <SidebarEmptyState icon={<TbGhost3 />} title={translate("sidebar.loading_subjects")} />}
      {hydrated && !loading && subjects.length === 0 ? <SidebarEmptyState
        icon={<TbGhost3 />}
        title={translate("sidebar.no_subjects")}
        action={<Button variant="primary" onClick={open_create_agent}>{translate("sidebar.new_agent")}</Button>}
      /> : null}
    </SidebarContent>
  </SidebarPanel>;
});

/** Agent 主体行：点击进入 profile。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, active, unread_attention }: {
  /** Agent 摘要。 */ agent: DesktopAgentSummary;
  /** 稳定控制器。 */ controller: DesktopController;
  /** 是否为当前 Agent。 */ active: boolean;
  /** 当前 Agent 未读通知表达的注意力等级。 */ unread_attention: ReturnType<typeof get_agent_unread_attention>;
}) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  // 字符串级订阅：只有该 Agent 的行状态变化时才重渲染，消息流 / runtime 的其它更新不触发。
  const live = use_desktop_selector(controller.stores.chat_stream, (state) => state.agent_chat_status[agent.agent_id] ?? null);
  const status = resolve_chat_row_status(live, unread_attention);
  const [delete_open, set_delete_open] = useState(false);
  return <>
    <SidebarItem
      variant="agent"
      active={active}
      leading={<AgentAvatar agent={agent} class_name="size-8" />}
      title={agent.name}
      // 空描述不再兜底成「暂无描述」：那句话会在新建几个 Agent 之后铺满整列，
      // 而行高随之退回单行档。真正需要用户知道的只有「这个 Agent 是什么」，
      // 而它没有描述时，静默比复述一遍「没有」更诚实。
      description={agent.description || undefined}
      // 点击进 profile：这一行现在只回答「这个 Agent 是谁」，会话入口在 Works 侧栏。
      onSelect={() => controller.actions.select_agent(agent.agent_id)}
      menu={<DropdownMenu>
        <DropdownMenuTrigger asChild><RowMenuButton status={status} label={translate("sidebar.subject_actions_for", { name: agent.name })} /></DropdownMenuTrigger>
        {/* 菜单里的点击不要冒泡到所在行，否则会顺带打开这个 Agent。 */}
        <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
          {/* 会话入口不在这里：它属于 Workspace，因此只有一个位置（见 WorksSidebar）。 */}
          <DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{translate("sidebar.permanent_delete")}</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    />
    <SubjectDeleteDialog
      open={delete_open}
      set_open={set_delete_open}
      title={translate("sidebar.delete_agent_title", { name: agent.name })}
      description={translate("sidebar.delete_agent_description")}
      confirm_label={translate("sidebar.permanent_delete")}
      pending_label={translate("sidebar.deleting")}
      on_confirm={() => controller.actions.remove_agent(agent.agent_id)}
      cancel_label={translate_common("actions.cancel")}
    />
  </>;
});

/** Group 主体行：点击进入配置页。 */
const GroupSubject = memo(function GroupSubject({ group, controller, agents, active, unread_attention, open_group_config }: {
  /** Group 摘要。 */ group: DesktopGroupSummary;
  /** 稳定控制器。 */ controller: DesktopController;
  /** 全部 Agent；用于绘制成员头像。 */ agents: DesktopAgentSummary[];
  /** 是否为当前 Group。 */ active: boolean;
  /** 当前 Group 未读通知表达的注意力等级。 */ unread_attention: ReturnType<typeof get_group_unread_attention>;
  /** 打开 Group 配置页。 */ open_group_config(group_id: string): void;
}) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  // Group 的实时状态只在当前打开的 GroupSession 上产生，因此侧栏能区分「等成员响应」与「正在推进」；
  // 未打开时的等待与失败仍由未读通知表达。
  const has_pending_interaction = use_desktop_selector(controller.stores.chat_stream, (state) => (state.group_interactions_by_group[group.group_id]?.length ?? 0) > 0);
  const group_running = use_desktop_selector(controller.stores.chat_stream, (state) => is_group_phase_running(state.group_phase_by_group[group.group_id]));
  const status = resolve_chat_row_status(resolve_group_chat_live_status({ has_pending_interaction, running: group_running }), unread_attention);
  const [delete_open, set_delete_open] = useState(false);
  return <>
    <SidebarItem
      variant="agent"
      active={active}
      leading={<GroupAvatar group={group} agents={agents} />}
      title={group.name}
      tag={translate("sidebar.members", { count: group.members.length })}
      description={group.instruction || undefined}
      onSelect={() => open_group_config(group.group_id)}
      menu={<DropdownMenu>
        <DropdownMenuTrigger asChild><RowMenuButton status={status} label={translate("sidebar.subject_actions_for", { name: group.name })} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={5} onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>{translate("sidebar.group_settings")}</span></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{translate_common("actions.delete")}</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    />
    <SubjectDeleteDialog
      open={delete_open}
      set_open={set_delete_open}
      title={translate("sidebar.delete_group_title", { name: group.name })}
      description={translate(active ? "sidebar.delete_active_group_description" : "sidebar.delete_group_description")}
      confirm_label={translate_common("actions.delete")}
      pending_label={translate("sidebar.deleting")}
      on_confirm={() => controller.actions.remove_group(group.group_id)}
      cancel_label={translate_common("actions.cancel")}
    />
  </>;
});

/**
 * 主体删除前的确认 Dialog。
 *
 * 失败不吞掉：错误就地显示在这个对话框里，而不是抛到全局错误条——
 * 用户此刻的注意力在这个对话框上，错误出现在别处等于没提示。
 */
function SubjectDeleteDialog({ open, set_open, title, description, confirm_label, pending_label, cancel_label, on_confirm }: {
  /** 是否可见。 */ open: boolean;
  /** 修改可见性。 */ set_open(open: boolean): void;
  /** 标题。 */ title: string;
  /** 风险说明。 */ description: string;
  /** 确认按钮文案。 */ confirm_label: string;
  /** 执行中的确认按钮文案。 */ pending_label: string;
  /** 取消按钮文案。 */ cancel_label: string;
  /** 执行删除。 */ on_confirm(): Promise<void> | void;
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
      <DialogFooter>
        <Button disabled={pending} onClick={() => set_open(false)}>{cancel_label}</Button>
        <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? pending_label : confirm_label}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
