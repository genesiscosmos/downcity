/** 运行时 Group 共享消息视图，保持与 Agent Session Chat 一致的视觉结构。 */

import { memo, useMemo, type ReactNode } from "react";
import { TbChevronRight, TbDots, TbEdit, TbFileText, TbFolder, TbTrash, TbUsers } from "react-icons/tb";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { SettingActionItem, SettingGroup, SettingItem, SettingSection, SettingsContainer, SettingsMainContent } from "@/components/settings/SettingComponents";
import { Switch } from "@/components/ui/switch";
import { ChatMessageViewportRow } from "@/features/chat/components/ChatMessageViewportRow";
import { ChatTextSelectionQuote } from "@/features/chat/components/ChatTextSelectionQuote";
import { ChatWorkspaceSelector } from "@/features/chat/components/ChatWorkspaceSelector";
import { WorkspaceTagMenu } from "@/features/chat/components/WorkspaceTagMenu";
import { use_chat_scroll } from "@/features/chat/lib/use_chat_scroll";
import { get_group_chat_key } from "@/features/chat/lib/chat_cache_key";
import { dispatch_chat_mention } from "@/features/chat/composer/editor/chatMentionEvent";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopGroupStatusPhase, DesktopModelSummary, DesktopSettings } from "@common/types/DesktopApi";
import type { RespondSessionInteractionInput, SessionAgentInteractionPart } from "@downcity/agent";
import { ChatSurfaceLayout } from "@/features/chat/components/ChatLayout";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";
import { use_baybar_open } from "@/layouts/BayBar";
import { Markdown } from "@/components/markdown/Markdown";
import type { DesktopAgentSummary, DesktopGroupMemberRuntime, DesktopGroupMessage, DesktopGroupSessionSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { AgentInteraction } from "@/features/chat/components/messages/AgentInteraction";
import { is_group_draft_session_id } from "@/types/DesktopView";
import type { GroupMessageProjection, GroupMessageSegment } from "@/types/GroupProjection";
import { use_translation } from "@/locales/i18n";

/** Group 定义侧栏可以编辑的分区。 */
export type GroupEditorSection = "model" | "instruction" | "members";

const empty_chat_items: never[] = [];
interface GroupViewProps {
  /** 当前运行时 Group。 */
  group: DesktopGroupSummary;
  /** 当前 Desktop 可用 Agent。 */
  agents: DesktopAgentSummary[];
  /** Desktop Chat 设置。 */
  settings: DesktopSettings;
  /** 当前共享消息的持久分段投影。 */
  message_projection?: GroupMessageProjection;
  /** 当前 GroupSession 的成员运行态。 */
  member_statuses: DesktopGroupMemberRuntime[];
  /** 当前 GroupSession 的运行阶段。 */
  group_phase: DesktopGroupStatusPhase;
  /** 当前待响应的成员交互。 */
  interactions: { agent_id: string; part: SessionAgentInteractionPart }[];
  /** 响应成员交互。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
  /** 向 Group 发送文本。 */
  /** 当前 GroupSession 摘要。 */
  session: DesktopGroupSessionSummary;
  /** 当前 GroupSession 所属 Workspace。 */
  workspace_id: string;
  /** Desktop 当前可选 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前是否为尚未创建的 Group Session 草稿。 */
  workspace_draft_mode?: boolean;
  /** 在目标 Workspace 开启新的 Group 对话。 */
  switch_workspace(workspace_id: string): Promise<void> | void;
  /** 当前 Group Chat 自己的输入区域。 */
  composer: ReactNode;
  /** 删除当前 Group Session；草稿态不提供。 */
  remove_session?(): Promise<void>;
}

/** Group 复用 Agent Chat 的消息流和输入区布局，但保留共享消息语义。 */
export function GroupView({ group, agents, settings, message_projection, member_statuses, group_phase, interactions, respond_interaction, session, workspace_id, workspaces, workspace_draft_mode, switch_workspace, composer, remove_session }: GroupViewProps) {
  const translate = use_translation("resources");
  const scroll_surface_id = get_group_chat_key(workspace_id, group.group_id, session.session_id);
  const { scroll_ref, content_ref, bottom_ref, handle_scroll } = use_chat_scroll(scroll_surface_id, settings.auto_scroll);

  const agents_by_id = useMemo(() => new Map(agents.map((agent) => [agent.agent_id, agent])), [agents]);
  const running_agent_ids = useMemo(() => group_phase === "executing" ? member_statuses.filter((status) => status.running).map((status) => status.agent_id) : empty_chat_items, [group_phase, member_statuses]);

  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  const workspace_tag = workspace_draft_mode
    ? <ChatWorkspaceSelector workspace_id={workspace_id} workspaces={workspaces} disabled={group_phase !== "idle"} switch_workspace={switch_workspace} />
    : workspace
      ? <WorkspaceTagMenu workspace={workspace} />
      : <span className="inline-flex h-5 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.045] px-2 text-[0.625rem] font-normal text-muted-foreground"><TbFolder className="size-3 shrink-0" /><span className="truncate">{workspace_id}</span></span>;
  // Group 编辑面板由当前 MainView 注册，这里只需按标识打开。
  const open_panel = use_baybar_open();
  const group_session_title = format_group_session_title(session, translate("group_details.empty_title"));
  return <ChatSurfaceLayout header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><span className="min-w-0 truncate text-xs font-medium text-foreground" title={group_session_title}>{group_session_title}</span>{workspace_tag}</div>} header_right={<div className="flex shrink-0 items-center gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title={translate("group_details.actions")} aria-label={translate("group_details.actions")}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => open_panel(GROUP_DOMAIN_ID)}><TbEdit /><span>{translate("group_details.settings")}</span></DropdownMenuItem>{remove_session ? <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm(translate("group_details.delete_chat_confirmation"))) void remove_session(); }}><TbTrash /><span>{translate("group_details.delete_chat")}</span></DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></div>}>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div ref={scroll_ref} onScroll={handle_scroll} className="chat-scroll-viewport relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log">
          <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
          <div ref={content_ref} className="chat-scroll-content mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {!message_projection?.message_count ? <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4"><TbUsers className="size-8 text-muted-foreground/50" /><p className="text-center text-sm text-muted-foreground">{translate("group_details.empty_chat", { name: group.name })}</p><p className="text-center text-xs text-muted-foreground/60">{translate("group_details.joined_agents", { count: group.members.length })}</p></div> : null}
            {message_projection?.segments.map((segment) => <GroupMessageSegmentRows key={segment.segment_id} segment={segment} agents_by_id={agents_by_id} />)}
            {interactions.map(({ agent_id, part }) => <GroupInteractionRow key={part.interaction_id} agent={agents_by_id.get(agent_id)} agent_id={agent_id} part={part} respond_interaction={respond_interaction} />)}
            {running_agent_ids.map((agent_id) => <GroupTypingRow key={`typing:${agent_id}`} agent={agents_by_id.get(agent_id)} agent_id={agent_id} />)}
          </div>
          <div ref={bottom_ref} className="chat-scroll-bottom-anchor" aria-hidden="true" />
        </div>
        {composer}
      </div>
  </ChatSurfaceLayout>;
}

/** 只在当前固定分段或其渲染依赖变化时协调其中的 Group 消息。 */
const GroupMessageSegmentRows = memo(function GroupMessageSegmentRows({ segment, agents_by_id }: { /** 稳定 Group 消息分段。 */ segment: GroupMessageSegment; /** Agent 标识索引。 */ agents_by_id: Map<string, DesktopAgentSummary> }) {
  return <>{segment.messages.map((message) => <ChatMessageViewportRow key={message.message_id} row_id={message.message_id}><GroupMessageRow message={message} agent={message.author_id ? agents_by_id.get(message.author_id) : undefined} read={segment.read_message_ids.has(message.message_id)} /></ChatMessageViewportRow>)}</>;
}, (previous, next) => previous.segment === next.segment
  && previous.agents_by_id === next.agents_by_id);

/** Group 联系人主页面，只展示摘要和可进入的具体配置项。 */
export function GroupConfigView({ group, agents }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** 全部 Agent。 */ agents: DesktopAgentSummary[] }) {
  const translate = use_translation("resources");
  const translate_common = use_translation();
  // 右侧编辑面板由 MainView 提供；这里只需按「域 + 分区」打开。
  const open_baybar = use_baybar_open();
  const content = <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><SettingsMainContent><SettingsContainer><SettingSection title="Group" description={translate("group_details.description")}><SettingGroup><SettingActionItem icon={<LLMModelIcon model_id={group.model_id} />} label="Model" description={translate("group_details.model_description")} trailing={<><span className="max-w-48 truncate">{group.model_id || translate_common("state.not_configured")}</span><TbChevronRight /></>} on_select={() => open_baybar(GROUP_DOMAIN_ID, "model")} /><SettingActionItem icon={<TbFileText />} label={translate("group_details.goal")} description={translate("group_details.goal_description")} trailing={<><span>{group.instruction ? translate("group_details.characters", { count: group.instruction.length }) : translate("group_details.not_set")}</span><TbChevronRight /></>} on_select={() => open_baybar(GROUP_DOMAIN_ID, "instruction")} /><SettingActionItem icon={<TbUsers />} label={translate("group_details.members")} description={translate("group_details.members_description")} trailing={<><span>{translate("group_details.members_count", { count: group.members.length })}</span><TbChevronRight /></>} on_select={() => open_baybar(GROUP_DOMAIN_ID, "members")} /></SettingGroup></SettingSection></SettingsContainer></SettingsMainContent></div>;
  return <>
    <MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><GroupAvatar group={group} agents={agents} /><span className="truncate">{group.name}</span></span>} />
    <MainViewBody>{content}</MainViewBody>
  </>;
}

/** 生成 GroupSession 的紧凑显示标题。 */
function format_group_session_title(session: DesktopGroupSessionSummary, empty_title: string): string {
  if (is_group_draft_session_id(session.session_id)) return empty_title;
  return session.title?.trim() || empty_title;
}

/** 一级域「Group」的稳定标识。 */
export const GROUP_DOMAIN_ID = "group";

/** Group 配置分区，作为域内的二级分区。 */
export const GROUP_EDITOR_SECTIONS: readonly { id: GroupEditorSection; label_key: string | null; label?: string }[] = [
  { id: "model", label_key: null, label: "Model" },
  { id: "instruction", label_key: "group_details.goal" },
  { id: "members", label_key: "group_details.members" },
];

/** Group 单个分区的内容属性。 */
interface GroupEditorPanelProps {
  /** 当前编辑草稿。 */ group: DesktopGroupSummary;
  /** 全部 Agent。 */ agents: DesktopAgentSummary[];
  /** Desktop 稳定控制器。 */ controller: DesktopController;
  /** 当前编辑分区。 */ section: GroupEditorSection;
  /** 用新草稿替换当前值。 */ set_group(group: DesktopGroupSummary): void;
}

/**
 * Group 单个分区的编辑内容。
 *
 * 纯视图：草稿状态由页面通过 use_group_draft 持有，分区导航由 BayBar 负责。
 */
export function GroupEditorPanel({ group, agents, controller, section, set_group }: GroupEditorPanelProps) {
  const translate = use_translation("resources");
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const content = section === "model"
    ? <GroupModelEditor group={group} models={models} models_loading={models_loading} set_group={set_group} />
    : section === "instruction"
      ? <textarea value={group.instruction || ""} onChange={(event) => set_group({ ...group, instruction: event.target.value })} placeholder={translate("group_details.goal_placeholder")} className="h-full min-h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-6 text-foreground outline-none" />
      : <SettingGroup>{agents.map((agent) => {
        const active = group.members.some((member) => member.agent_id === agent.agent_id);
        return <SettingItem key={agent.agent_id} label={agent.name} leading={<AgentAvatar agent={agent} class_name="size-5 rounded" />}><Switch checked={active} disabled={active && group.members.length === 1} onCheckedChange={(checked) => { const members = checked ? [...group.members, { agent_id: agent.agent_id }] : group.members.filter((member) => member.agent_id !== agent.agent_id); if (members.length > 0) set_group({ ...group, members }); }} aria-label={translate("group_details.member_state", { name: agent.name })} /></SettingItem>;
      })}</SettingGroup>;
  return <div className={`h-full min-h-0 w-full ${section === "instruction" ? "" : "p-2"}`}>{content}</div>;
}

function GroupModelEditor({ group, models, models_loading, set_group }: { /** 当前编辑草稿。 */ group: DesktopGroupSummary; /** 可用模型。 */ models: DesktopModelSummary[]; /** 模型目录加载态。 */ models_loading: boolean; /** 更新 Group 草稿。 */ set_group(group: DesktopGroupSummary): void }) {
  const translate = use_translation("chat");
  const text_models = models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  if (models_loading && text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">{translate("model.loading")}</div>;
  if (text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">{translate("model.empty")}</div>;
  return <SettingGroup>{text_models.map((model) => <SettingActionItem key={model.model_id} icon={<LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" />} label={model.name} active={model.model_id === group.model_id} on_select={() => set_group({ ...group, model_id: model.model_id })} />)}</SettingGroup>;
}

/** 按 Agent Chat 的左右消息结构渲染 Group 共享消息。 */
const GroupMessageRow = memo(function GroupMessageRow({ message, agent, read }: { /** Group 共享消息。 */ message: DesktopGroupMessage; /** 消息所属 Agent；用户与系统消息为空。 */ agent?: DesktopAgentSummary; /** 用户消息是否已完成 Dispatch。 */ read: boolean }) {
  const translate = use_translation("resources");
  if (message.author_type === "user") return <div className="group is-user flex w-full items-end justify-end gap-2 py-2"><div className="w-full flex justify-end"><div className="user-message-stack flex w-fit max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5"><div className="ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-sm text-foreground"><div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="user" className="break-words text-[0.8125rem] leading-[1.34]"><Markdown text={message.text} mode="static" /></div></div><div className="flex items-center gap-1.5 px-1">{read ? <span className="text-[0.6875rem] text-muted-foreground">{translate("group_details.read")}</span> : null}<ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div></div></div></div>;
  if (message.author_type === "system") return <div className="group flex w-full items-center gap-3 py-2"><span className="h-px min-w-4 flex-1 bg-border/60" /><span className="flex max-w-[80%] items-center gap-2 text-center text-[0.75rem] text-muted-foreground"><span>{message.text}</span><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></span><span className="h-px min-w-4 flex-1 bg-border/60" /></div>;
  return <div className="group is-agent flex min-w-0 w-full items-start gap-2 py-2"><button type="button" disabled={!agent} onClick={() => { if (agent) dispatch_chat_mention(agent); }} className="size-8 shrink-0 rounded-md transition-opacity duration-150 enabled:hover:opacity-75" title={agent ? `@${agent.name}` : undefined} aria-label={agent ? translate("group_details.mention", { name: agent.name }) : undefined}><AgentAvatar agent={agent ?? { agent_id: message.author_id || "Agent", model_id: "", version: "" }} class_name="size-8 rounded-md" /></button><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground"><span>{agent?.name || "Agent"}</span><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div><div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="agent" className="max-w-full overflow-hidden rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2 text-[0.8125rem] leading-[1.54]"><Markdown text={message.text} mode="static" /></div></div></div>;
});

/** 待响应的 Group 成员交互；其它消息变化时保持渲染结果。 */
const GroupInteractionRow = memo(function GroupInteractionRow({ agent, agent_id, part, respond_interaction }: { /** 发起交互的 Agent。 */ agent?: DesktopAgentSummary; /** 发起交互的 Agent 标识。 */ agent_id: string; /** canonical Interaction part。 */ part: SessionAgentInteractionPart; /** 提交交互响应。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const translate = use_translation("resources");
  return <div className="group is-agent flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agent ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 flex-1 px-1 pt-0.5"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{translate("group_details.response_required", { name: agent?.name || "Agent" })}</div><AgentInteraction part={part} respond={respond_interaction} /></div></div>;
});

/** Group 成员正在生成消息时，直接在消息流中显示输入状态。 */
const GroupTypingRow = memo(function GroupTypingRow({ agent, agent_id }: { /** 正在输入的 Agent。 */ agent?: DesktopAgentSummary; /** Agent 标识。 */ agent_id: string }) {
  const translate = use_translation("resources");
  return <div className="group is-agent flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agent ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{agent?.name || "Agent"}</div><div className="rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2 text-[0.8125rem] leading-[1.54] text-muted-foreground">{translate("group_details.typing")}</div></div></div>;
});


