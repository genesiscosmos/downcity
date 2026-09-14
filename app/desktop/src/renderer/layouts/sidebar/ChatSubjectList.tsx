/** Chat Sidebar 的 Agent 与 Group 主体列表。 */

import { memo, useState, type ReactNode } from "react";
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

/** 渲染 Chat 主体列表及其空状态。 */
export function ChatSubjectList(props: ChatSubjectListProps) {
  const translate = use_translation("navigation");
  return <SidebarContent class_name="space-y-1">
    {props.hydrated ? props.subjects.map((subject) => subject.kind === "agent"
      ? <AgentSubject key={subject.key} agent={subject.agent} controller={props.controller} active={subject.agent.agent_id === props.selected_agent_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} unread_attention={get_agent_unread_attention(props.notification_state, subject.agent.agent_id)} />
      : <GroupSubject key={subject.key} group={subject.group} controller={props.controller} active={subject.group.group_id === props.selected_group_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} agents={props.agents} unread_attention={get_group_unread_attention(props.notification_state, subject.group.group_id)} open_group_config={props.open_group_config} />,
    ) : null}
    {props.hydrated && !props.loading && props.subjects.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{translate("sidebar.no_subjects")}</div><Button className="mt-3" variant="primary" onClick={props.open_create_agent}>{translate("sidebar.new_agent")}</Button></div> : null}
  </SidebarContent>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, active, active_workspace_id, workspaces, unread_attention }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Agent。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null }) {
  const translate = use_translation("navigation");
  // 字符串级订阅：只有该 Agent 的行状态变化时才重渲染，消息流 / runtime 的其它更新不触发。
  const live = use_desktop_selector(controller.stores.chat_stream, (state) => state.agent_chat_status[agent.agent_id] ?? null);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  return <ChatSubjectRow
    avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />}
    title={agent.name}
    description={agent.description || translate("sidebar.no_description")}
    active={Boolean(active)}
    status={resolve_chat_row_status(live, unread_attention)}
    menu_label={translate("sidebar.agent_actions")}
    on_select={() => void controller.actions.open_agent_chat(agent.agent_id)}
    render_menu_items={(open_delete) => <>
      <DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem>
      <DropdownMenuItem onClick={() => controller.actions.select_agent(agent.agent_id)}><TbEdit /><span>{translate("sidebar.agent_settings")}</span></DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={open_delete}><TbTrash /><span>{translate("sidebar.permanent_delete")}</span></DropdownMenuItem>
    </>}
    delete_confirm={{
      title: translate("sidebar.delete_agent_title", { name: agent.name }),
      description: translate("sidebar.delete_agent_description"),
      confirm_label: translate("sidebar.permanent_delete"),
      on_confirm: () => controller.actions.remove_agent(agent.agent_id),
    }}
  />;
});

/** 可直接进入聊天工作区的 Group 主体行。 */
const GroupSubject = memo(function GroupSubject({ group, controller, active, active_workspace_id, workspaces, agents, unread_attention, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Group。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 当前 Group 未读通知表达的注意力等级。 */ unread_attention: ChatAttention | null; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  // Group 的实时状态只在当前打开的 GroupSession 上产生，因此侧栏能区分「等成员响应」与「正在推进」；
  // 未打开时的等待与失败仍由未读通知表达。
  const has_pending_interaction = use_desktop_selector(controller.stores.chat_stream, (state) => (state.group_interactions_by_group[group.group_id]?.length ?? 0) > 0);
  const group_running = use_desktop_selector(controller.stores.chat_stream, (state) => is_group_phase_running(state.group_phase_by_group[group.group_id]));
  return <ChatSubjectRow
    avatar={<GroupAvatar group={group} agents={agents} />}
    title={group.name}
    tag={translate("sidebar.members", { count: group.members.length })}
    description={group.instruction || translate("sidebar.no_description")}
    active={active}
    status={resolve_chat_row_status(resolve_group_chat_live_status({ has_pending_interaction, running: group_running }), unread_attention)}
    menu_label={translate("sidebar.group_actions")}
    on_select={() => void controller.actions.open_group(group.group_id)}
    render_menu_items={(open_delete) => <>
      <DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_group_session(group.group_id, workspace_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem>
      <DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>{translate("sidebar.group_settings")}</span></DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={open_delete}><TbTrash /><span>{common_translate("actions.delete")}</span></DropdownMenuItem>
    </>}
    delete_confirm={{
      title: translate("sidebar.delete_group_title", { name: group.name }),
      description: translate(active ? "sidebar.delete_active_group_description" : "sidebar.delete_group_description"),
      confirm_label: common_translate("actions.delete"),
      on_confirm: () => controller.actions.remove_group(group.group_id),
    }}
  />;
});

/** Agent 与 Group 共用的主体行：状态展示、操作菜单与删除确认都在这里闭合。 */
function ChatSubjectRow({ avatar, title, tag, description, active, status, menu_label, render_menu_items, on_select, delete_confirm }: {
  /** 主体头像。 */
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
  /** 操作菜单入口的动作名称。 */
  menu_label: string;
  /** 操作菜单项；删除项需要本组件闭合的确认流程，因此以回调形式接收打开删除的动作。 */
  render_menu_items(open_delete: () => void): ReactNode;
  /** 打开主体。 */
  on_select(): void;
  /** 删除确认的文案与执行入口；可见状态由本组件闭合。 */
  delete_confirm: { /** 标题。 */ title: string; /** 风险说明。 */ description: string; /** 确认按钮文案。 */ confirm_label: string; /** 执行删除。 */ on_confirm(): Promise<void> | void };
}) {
  const [delete_open, set_delete_open] = useState(false);
  return <>
    <ChatSubjectItem
      avatar={avatar}
      title={title}
      tag={tag}
      description={description}
      active={active}
      status={status}
      on_select={on_select}
      menu={<DropdownMenu>
        <DropdownMenuTrigger asChild><RowMenuButton status={status} label={menu_label} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{render_menu_items(() => set_delete_open(true))}</DropdownMenuContent>
      </DropdownMenu>}
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

/** Agent 与 Group 共用的主体行；状态文案与动效由行状态唯一决定，右侧菜单自身承载状态图标。 */
function ChatSubjectItem({ avatar, title, tag, description, active, status, on_select, menu }: { /** 主体头像。 */ avatar: ReactNode; /** 主体名称。 */ title: string; /** 可选分类信息。 */ tag?: string; /** 无状态时的行描述。 */ description: ReactNode; /** 是否为当前主体。 */ active: boolean; /** 当前行状态。 */ status: ChatRowStatus; /** 打开主体。 */ on_select(): void; /** 主体操作菜单。 */ menu: ReactNode }) {
  const translate_chat = use_translation("chat");
  const description_key = chat_row_status_description_key(status);
  const status_text = description_key ? translate_chat(description_key) : null;
  return <div className={cn("group/item flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150 [&_button]:cursor-pointer", active ? "bg-interaction-selected hover:bg-interaction-active" : "hover:bg-interaction-hover")}>
    <button type="button" aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={on_select}>
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span>
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
    <span className="relative flex size-7 shrink-0 items-center justify-center">{menu}</span>
  </div>;
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
