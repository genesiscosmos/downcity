/** Chat Sidebar 的 Agent 与 Group 主体列表。 */

import { memo, useState, type ReactNode } from "react";
import { TbDots, TbEdit, TbGhost3, TbLoader2, TbPlus, TbTrash } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { UnreadIndicator } from "@/components/UnreadIndicator";
import { use_desktop_selector } from "@/app/use_desktop";
import { get_agent_unread_attention, get_group_unread_attention } from "@/lib/notification/notification_state";
import { unread_attention_visual, type UnreadAttention } from "@/lib/notification/unread_attention";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarContent } from "./SidebarPanel";
import { is_persistent_chat_subject_menu_status, resolve_chat_subject_menu_status } from "./chat_subject_item_state";

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
  /** 可进入 Chat 的 Agent。 */
  agents: DesktopAgentSummary[];
  /** 可进入 Chat 的 Group。 */
  groups: DesktopGroupSummary[];
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
    {props.agents.map((agent) => <AgentSubject key={agent.agent_id} agent={agent} controller={props.controller} active={agent.agent_id === props.selected_agent_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} unread_attention={get_agent_unread_attention(props.notification_state, agent.agent_id)} />)}
    {props.groups.map((group) => <GroupSubject key={group.group_id} group={group} controller={props.controller} active={group.group_id === props.selected_group_id} active_workspace_id={props.active_workspace_id} workspaces={props.workspaces} agents={props.agents} unread_attention={get_group_unread_attention(props.notification_state, group.group_id)} open_group_config={props.open_group_config} />)}
    {!props.loading && props.agents.length === 0 && props.groups.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-center"><TbGhost3 className="mb-2 size-5 text-muted-foreground" /><div className="text-xs text-foreground">{translate("sidebar.no_subjects")}</div><Button className="mt-3" variant="primary" onClick={props.open_create_agent}>{translate("sidebar.new_agent")}</Button></div> : null}
  </SidebarContent>;
}

/** 可直接进入聊天工作区的 Agent 主体行。 */
const AgentSubject = memo(function AgentSubject({ agent, controller, active, active_workspace_id, workspaces, unread_attention }: { /** Agent 摘要。 */ agent: DesktopAgentSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Agent。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent 未读通知表达的注意力等级。 */ unread_attention: UnreadAttention | null }) {
  const translate = use_translation("navigation");
  const [delete_open, set_delete_open] = useState(false);
  // 布尔级订阅：只有该 Agent 的运行态翻转时才重渲染，消息流/runtime 的其它更新不触发。
  const running = use_desktop_selector(controller.stores.chat_stream, (state) => state.executing_agent_ids.has(agent.agent_id));
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const menu_status = resolve_chat_subject_menu_status({ running, unread: unread_attention !== null });
  const menu_persistent = is_persistent_chat_subject_menu_status(menu_status);
  return <><ChatSubjectItem avatar={<AgentAvatar agent={agent} class_name="size-8 rounded-md" />} title={agent.name} description={running ? translate("sidebar.replying") : agent.description || translate("sidebar.no_description")} active={Boolean(active)} unread_attention={unread_attention} status_active={running} on_select={() => void controller.actions.open_agent_chat(agent.agent_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className={menu_persistent ? "opacity-100" : "opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"} title={translate("sidebar.agent_actions")} aria-label={translate("sidebar.agent_actions")}>{menu_status === "running" ? <TbLoader2 className="animate-spin text-primary motion-reduce:animate-none" /> : unread_attention ? <UnreadIndicator attention={unread_attention} /> : <TbDots />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_session(workspace_id, agent.agent_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem><DropdownMenuItem onClick={() => controller.actions.select_agent(agent.agent_id)}><TbEdit /><span>{translate("sidebar.agent_settings")}</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{translate("sidebar.permanent_delete")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={translate("sidebar.delete_agent_title", { name: agent.name })} description={translate("sidebar.delete_agent_description")} confirm_label={translate("sidebar.permanent_delete")} on_confirm={() => controller.actions.remove_agent(agent.agent_id)} /></>;
});

/** 可直接进入聊天工作区的 Group 主体行。 */
const GroupSubject = memo(function GroupSubject({ group, controller, active, active_workspace_id, workspaces, agents, unread_attention, open_group_config }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** 稳定控制器。 */ controller: DesktopController; /** 是否为当前 Group。 */ active: boolean; /** 当前 Workspace。 */ active_workspace_id: string; /** Workspace 列表。 */ workspaces: DesktopWorkspaceSummary[]; /** Agent 列表。 */ agents: DesktopAgentSummary[]; /** 当前 Group 未读通知表达的注意力等级。 */ unread_attention: UnreadAttention | null; /** 打开 Group 配置。 */ open_group_config(group_id: string): void }) {
  const translate = use_translation("navigation");
  const common_translate = use_translation();
  const [delete_open, set_delete_open] = useState(false);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;
  const menu_persistent = unread_attention !== null;
  return <><ChatSubjectItem avatar={<GroupAvatar group={group} agents={agents} />} title={group.name} tag={translate("sidebar.members", { count: group.members.length })} description={group.instruction || translate("sidebar.no_description")} active={active} unread_attention={unread_attention} on_select={() => void controller.actions.open_group(group.group_id)} menu={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className={menu_persistent ? "opacity-100" : "opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"} title={translate("sidebar.group_actions")} aria-label={translate("sidebar.group_actions")}>{unread_attention ? <UnreadIndicator attention={unread_attention} /> : <TbDots />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!workspace_id} onClick={() => { if (workspace_id) void controller.actions.create_group_session(group.group_id, workspace_id); }}><TbPlus /><span>{translate("sidebar.new_chat")}</span></DropdownMenuItem><DropdownMenuItem onClick={() => open_group_config(group.group_id)}><TbEdit /><span>{translate("sidebar.group_settings")}</span></DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => set_delete_open(true)}><TbTrash /><span>{common_translate("actions.delete")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /><SubjectDeleteDialog open={delete_open} set_open={set_delete_open} title={translate("sidebar.delete_group_title", { name: group.name })} description={translate(active ? "sidebar.delete_active_group_description" : "sidebar.delete_group_description")} confirm_label={common_translate("actions.delete")} on_confirm={() => controller.actions.remove_group(group.group_id)} /></>;
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

/** Agent 与 Group 共用的主体行；保持原有视觉结构，右侧菜单自身承载运行和未读状态。 */
function ChatSubjectItem({ avatar, title, tag, description, active, unread_attention = null, status_active = false, on_select, menu }: { /** 主体头像。 */ avatar: ReactNode; /** 主体名称。 */ title: string; /** 可选分类信息。 */ tag?: string; /** 状态或说明。 */ description: ReactNode; /** 是否为当前主体。 */ active: boolean; /** 未读通知表达的注意力等级。 */ unread_attention?: UnreadAttention | null; /** 是否显示运行状态。 */ status_active?: boolean; /** 打开主体。 */ on_select(): void; /** 主体操作菜单。 */ menu: ReactNode }) {
  const translate_chat = use_translation("chat");
  return <div className={cn("group/item flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors duration-150 [&_button]:cursor-pointer", active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07]")}>
    <button type="button" aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={on_select}>
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate text-xs font-medium text-foreground", tag ? "max-w-[55%] shrink" : "flex-1")}>{title}</span>
          {tag ? <span className="max-w-36 shrink truncate rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] font-normal leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/item:opacity-100">{tag}</span> : null}
        </span>
        <span className={cn("mt-1 flex h-3.5 min-w-0 items-center truncate text-[10px] leading-3.5", status_active ? "font-medium text-muted-foreground" : "text-muted-foreground/70")}>
          {status_active ? <ReplyingText text={String(description)} /> : description}
          {unread_attention ? <span className="sr-only">{translate_chat(unread_attention_visual[unread_attention].label_key)}</span> : null}
        </span>
      </span>
    </button>
    <span className="relative flex size-7 shrink-0 items-center justify-center">{menu}</span>
  </div>;
}

/** 保持 Replying 文案稳定，仅让三个点按 .、..、... 循环出现。 */
function ReplyingText({ text }: { /** Replying 本地化文案。 */ text: string }) {
  return <span className="inline-flex min-w-0 whitespace-nowrap" aria-label={`${text}...`}>
    <span aria-hidden="true">{text}</span>
    <span aria-hidden="true" className="chat-replying-dots inline-flex w-[1.5em]">
      <span>.</span><span>.</span><span>.</span>
    </span>
  </span>;
}
