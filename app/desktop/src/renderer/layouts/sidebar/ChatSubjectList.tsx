/** Chat Sidebar 的 Agent 与 Group 主体列表。 */

import { memo, useState, type ReactNode } from "react";
import { TbDots, TbEdit, TbGhost3, TbLoader2, TbPlus, TbTrash } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_desktop_selector } from "@/app/use_desktop";
import { has_unread_agent_notification } from "@/lib/notification/notification_state";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopModelSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarContent } from "./SidebarPanel";

/** Chat 主体列表属性。 */
interface ChatSubjectListProps {
  /** Renderer 根控制器。 */
  controller: DesktopController;
  /** 当前导航目标。 */
  selection: NavigationTarget | null;
  /** 当前 Workspace 标识。 */
  active_workspace_id: string;
  /** 可进入 Chat 的 Agent。 */
  agents: DesktopAgentSummary[];
  /** 可进入 Chat 的 Group。 */
  groups: DesktopGroupSummary[];
  /** 用于展示 Agent 模型名称的模型目录。 */
  models: DesktopModelSummary[];
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
    {props.agents.map((agent) => <AgentSubject key={agent.agent_id} agent={agent} controller={props.controller} selection={props.selection} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} models={props.models} notification_state={props.notification_state} />)}
    {props.groups.map((group) => <GroupSubject key={group.group_id} group={group} controller={props.controller} selection={props.selection} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} agents={props.agents} open_group_config={props.open_group_config} />)}
    {!props.loading && props.agents.length === 0 && props.groups.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{translate("sidebar.no_subjects")}</div><Button className="mt-3" variant="primary" onClick={props.open_create_agent}>{translate("sidebar.new_agent")}</Button></div> : null}
  </SidebarContent>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, selection, active_workspace_id, workspaces, models, notification_state }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 当前导航目标。 */ selection: NavigationTarget | null; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 模型目录。 */ models: DesktopModelSummary[]; /** 通知快照。 */ notification_state: DesktopNotificationState }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const [delete_open, set_delete_open] = useState(false);
  const model_label = models.find((model) => model.model_id === agent.model_id)?.name || agent.model_id || common_translate("state.not_configured");
  // 布尔级订阅：只有该 Agent 的运行态翻转时才重渲染，消息流/runtime 的其它更新不触发。
  const running = use_desktop_selector(controller.stores.chat_stream, (state) => state.executing_agent_ids.has(agent.agent_id));
  const active = selection && "agent_id" in selection && selection.agent_id === agent.agent_id;
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const unread = has_unread_agent_notification(notification_state, agent.agent_id);
  return <><ChatSubjectItem avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />} title={agent.name} tag={model_label} description={running ? translate("sidebar.replying") : agent.description || translate("sidebar.no_description")} active={Boolean(active)} unread={unread} status_active={running} on_select={() => void controller.actions.open_agent_chat(agent.agent_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title={translate("sidebar.agent_actions")} aria-label={translate("sidebar.agent_actions")}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem><DropdownMenuItem onClick={() => controller.actions.select_agent(agent.agent_id)}><TbEdit /><span>{translate("sidebar.agent_settings")}</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{translate("sidebar.permanent_delete")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={translate("sidebar.delete_agent_title", { name: agent.name })} description={translate("sidebar.delete_agent_description")} confirm_label={translate("sidebar.permanent_delete")} on_confirm={() => controller.actions.remove_agent(agent.agent_id)} /></>;
});

/** 可直接进入聊天工作区的 Group 主体行。 */
const GroupSubject = memo(function GroupSubject({ group, controller, selection, active_workspace_id, workspaces, agents, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 当前导航目标。 */ selection: NavigationTarget | null; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const [delete_open, set_delete_open] = useState(false);
  const in_group = selection && "group_id" in selection && selection.group_id === group.group_id;
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  return <><ChatSubjectItem avatar={<GroupAvatar group={group} agents={agents} />} title={group.name} tag={translate("sidebar.members", { count: group.members.length })} description={group.instruction || translate("sidebar.no_description")} active={Boolean(in_group)} on_select={() => void controller.actions.open_group(group.group_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" title={translate("sidebar.group_actions")} aria-label={translate("sidebar.group_actions")}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_group_session(group.group_id, workspace_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>{translate("sidebar.group_settings")}</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{common_translate("actions.delete")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={translate("sidebar.delete_group_title", { name: group.name })} description={translate(in_group ? "sidebar.delete_active_group_description" : "sidebar.delete_group_description")} confirm_label={common_translate("actions.delete")} on_confirm={() => controller.actions.remove_group(group.group_id)} /></>;
});

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

/** Agent 与 Group 共用的主体行。 */
function ChatSubjectItem({ avatar, title, tag, description, active, unread = false, status_active = false, on_select, menu }: { /** 主体头像。 */ avatar: ReactNode; /** 主体名称。 */ title: string; /** 分类信息。 */ tag: string; /** 状态或说明。 */ description: ReactNode; /** 是否为当前主体。 */ active: boolean; /** 是否存在未读结果。 */ unread?: boolean; /** 是否显示运行状态。 */ status_active?: boolean; /** 打开主体。 */ on_select(): void; /** 主体操作菜单。 */ menu: ReactNode }) {
  const translate_chat = use_translation("chat");
  return <div className={cn("group flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150 [&_button]:cursor-pointer", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}><button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={on_select}><span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1.5"><span className="max-w-[55%] shrink truncate text-xs font-medium text-foreground">{title}</span><span className="max-w-36 shrink truncate rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] font-normal leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">{tag}</span></span><span className={cn("mt-1 flex items-center gap-1.5 truncate text-[10px]", status_active ? "chat-status-highlight text-[11px] font-medium" : "text-muted-foreground/70")}>{description}</span></span></button><span className="relative flex size-7 shrink-0 items-center justify-center">{unread ? <span className="size-1.5 rounded-full bg-blue-500 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" aria-label={translate_chat("conversation.unread_result")} /> : null}{status_active ? <TbLoader2 className="size-3.5 animate-spin text-primary transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true" /> : null}<span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">{menu}</span></span></div>;
}
