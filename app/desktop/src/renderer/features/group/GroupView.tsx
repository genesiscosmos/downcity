/** 运行时 Group 共享消息视图，保持与 Agent Session Chat 一致的视觉结构。 */

import { memo, useMemo, useState, type ReactNode } from "react";
import { TbChevronRight, TbDots, TbEdit, TbFileText, TbFolder, TbPencil, TbTrash, TbUsers } from "react-icons/tb";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { use_group_draft } from "@/features/group/lib/use_group_draft";
import { dispatch_chat_mention } from "@/features/chat/composer/editor/chatMentionEvent";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopGroupStatusPhase, DesktopModelSummary, DesktopSettings } from "@common/types/DesktopApi";
import type { RespondSessionInteractionInput, SessionAgentInteraction } from "@downcity/agent";
import { ChatSurfaceLayout } from "@/features/chat/components/ChatLayout";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";
import { use_baybar_open, baybar_tab_id, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { Markdown } from "@/components/markdown/Markdown";
import type { DesktopAgentSummary, DesktopGroupMemberRuntime, DesktopGroupMessage, DesktopGroupSessionSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

import { AgentInteraction } from "@/features/chat/components/messages/AgentInteraction";
import { AgentMessageFrame } from "@/features/chat/components/messages/AgentMessageFrame";
import { AgentThinkingStatus } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { UserMessageFrame } from "@/features/chat/components/messages/UserMessageFrame";
import { chat_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import { cn } from "@/lib/utils";
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
  interactions: { agent_id: string; part: SessionAgentInteraction }[];
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
  /** 重命名当前 Group Session；草稿态不提供。 */
  rename_session?(title: string): Promise<void>;
  /** Renderer 稳定控制器，用于构造标签页。 */
  controller: DesktopController;
}

/** Group 复用 Agent Chat 的消息流和输入区布局，但保留共享消息语义。 */
export function GroupView({ group, agents, settings, message_projection, member_statuses, group_phase, interactions, respond_interaction, session, workspace_id, workspaces, workspace_draft_mode, switch_workspace, composer, remove_session, rename_session, controller }: GroupViewProps) {
  const translate = use_translation("resources");
  const translate_chat = use_translation("chat");
  const common_translate = use_translation();
  // 当前 Group Session 的重命名就地用一个轻量 Dialog；删除直接用 confirm。
  // 两者都放在页头菜单，与「Group 配置」并列——侧栏的旧对话面板移除后，这里是会话级操作的唯一位置。
  const [rename_open, set_rename_open] = useState(false);
  const [rename_pending, set_rename_pending] = useState(false);
  const [rename_title, set_rename_title] = useState("");
  const submit_rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rename_session || !rename_title.trim() || rename_pending) return;
    set_rename_pending(true);
    try {
      await rename_session(rename_title.trim());
      set_rename_open(false);
    } finally {
      set_rename_pending(false);
    }
  };
  const scroll_surface_id = get_group_chat_key(workspace_id, group.group_id, session.session_id);
  // Group 消息只会追加，首条消息 ID 天然不变，因此不会触发历史前插恢复。
  const { scroll_ref, content_ref, handle_scroll } = use_chat_scroll(scroll_surface_id, settings.auto_scroll, message_projection?.segments[0]?.messages[0]?.message_id ?? "");

  const agents_by_id = useMemo(() => new Map(agents.map((agent) => [agent.agent_id, agent])), [agents]);
  const running_agent_ids = useMemo(() => group_phase === "executing" ? member_statuses.filter((status) => status.running).map((status) => status.agent_id) : empty_chat_items, [group_phase, member_statuses]);

  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  const workspace_tag = workspace_draft_mode
    ? <ChatWorkspaceSelector workspace_id={workspace_id} workspaces={workspaces} disabled={group_phase !== "idle"} switch_workspace={switch_workspace} />
    : workspace
      ? <WorkspaceTagMenu workspace={workspace} />
      : <span className="inline-flex h-5 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-full bg-surface-subtle px-2 text-3xs font-normal text-muted-foreground"><TbFolder className="size-3 shrink-0" /><span className="truncate">{workspace_id}</span></span>;
  // Group 编辑面板在右侧打开；这里只需构造标签页。
  const open_panel = use_baybar_open();
  const open_group_tab = () => open_panel(group_config_tab(group, controller, translate));
  const group_session_title = format_group_session_title(session, translate("group_details.empty_title"));
  return <ChatSurfaceLayout header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><span className="min-w-0 truncate text-xs font-medium text-foreground" title={group_session_title}>{group_session_title}</span>{workspace_tag}</div>} header_right={<div className="flex shrink-0 items-center gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title={translate("group_details.actions")} aria-label={translate("group_details.actions")}><TbDots /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_group_tab}><TbEdit /><span>{translate("group_details.settings")}</span></DropdownMenuItem>{rename_session ? <DropdownMenuItem onClick={() => { set_rename_title(session.title || ""); set_rename_open(true); }}><TbPencil /><span>{translate_chat("conversation.rename")}</span></DropdownMenuItem> : null}{remove_session ? <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm(translate("group_details.delete_chat_confirmation"))) void remove_session(); }}><TbTrash /><span>{translate("group_details.delete_chat")}</span></DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></div>}>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div ref={scroll_ref} onScroll={handle_scroll} className="chat-scroll-viewport relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log">
          <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
          <div ref={content_ref} className="chat-scroll-content mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {!message_projection?.message_count ? <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4"><TbUsers className="size-8 text-subtle-foreground" /><p className="text-center text-sm text-muted-foreground">{translate("group_details.empty_chat", { name: group.name })}</p><p className="text-center text-xs text-muted-foreground">{translate("group_details.joined_agents", { count: group.members.length })}</p></div> : null}
            {message_projection?.segments.map((segment) => <GroupMessageSegmentRows key={segment.segment_id} segment={segment} agents_by_id={agents_by_id} />)}
            {interactions.map(({ agent_id, part }) => <GroupInteractionRow key={part.interaction_id} agent={agents_by_id.get(agent_id)} agent_id={agent_id} part={part} respond_interaction={respond_interaction} />)}
            {running_agent_ids.map((agent_id) => <GroupTypingRow key={`typing:${agent_id}`} agent={agents_by_id.get(agent_id)} agent_id={agent_id} />)}
          </div>
        </div>
        {composer}
      </div>
      {/* 重命名属于会话级操作，弹层不参与消息流几何，因此与内容区平行。 */}
      <Dialog open={rename_open} onOpenChange={set_rename_open}><DialogContent>
        <form onSubmit={(event) => void submit_rename(event)}>
          <DialogHeader><DialogTitle>{translate_chat("conversation.rename_title")}</DialogTitle><DialogDescription>{translate_chat("conversation.group_rename_description")}</DialogDescription></DialogHeader>
          <DialogBody><input autoFocus value={rename_title} onChange={(event) => set_rename_title(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground" /></DialogBody>
          <DialogFooter><Button type="button" onClick={() => set_rename_open(false)}>{common_translate("actions.cancel")}</Button><Button type="submit" variant="primary" disabled={rename_pending || !rename_title.trim()}>{common_translate(rename_pending ? "actions.saving" : "actions.save")}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>
  </ChatSurfaceLayout>;
}

/** 只在当前固定分段或其渲染依赖变化时协调其中的 Group 消息。 */
const GroupMessageSegmentRows = memo(function GroupMessageSegmentRows({ segment, agents_by_id }: { /** 稳定 Group 消息分段。 */ segment: GroupMessageSegment; /** Agent 标识索引。 */ agents_by_id: Map<string, DesktopAgentSummary> }) {
  return <>{segment.messages.map((message) => <ChatMessageViewportRow key={message.message_id} row_id={message.message_id}><GroupMessageRow message={message} agent={message.author_id ? agents_by_id.get(message.author_id) : undefined} read={segment.read_message_ids.has(message.message_id)} /></ChatMessageViewportRow>)}</>;
}, (previous, next) => previous.segment === next.segment
  && previous.agents_by_id === next.agents_by_id);

/** Group 联系人主页面，只展示摘要和可进入的具体配置项。 */
export function GroupConfigView({ group, agents, controller }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** 全部 Agent。 */ agents: DesktopAgentSummary[]; /** Renderer 稳定控制器，用于构造标签页。 */ controller: DesktopController }) {
  const translate = use_translation("resources");
  const translate_common = use_translation();
  // 右侧编辑面板由 MainView 提供；这里只需构造标签页并打开它。
  const open_baybar = use_baybar_open();
  const open_group_tab = (section: GroupEditorSection) => open_baybar(group_config_tab(group, controller, translate), section);
  const content = <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><SettingsMainContent><SettingsContainer><SettingSection title="Group" description={translate("group_details.description")}><SettingGroup><SettingActionItem icon={<LLMModelIcon model_id={group.model_id} />} label="Model" description={translate("group_details.model_description")} trailing={<><span className="max-w-48 truncate">{group.model_id || translate_common("state.not_configured")}</span><TbChevronRight /></>} on_select={() => open_group_tab("model")} /><SettingActionItem icon={<TbFileText />} label={translate("group_details.goal")} description={translate("group_details.goal_description")} trailing={<><span>{group.instruction ? translate("group_details.characters", { count: group.instruction.length }) : translate("group_details.not_set")}</span><TbChevronRight /></>} on_select={() => open_group_tab("instruction")} /><SettingActionItem icon={<TbUsers />} label={translate("group_details.members")} description={translate("group_details.members_description")} trailing={<><span>{translate("group_details.members_count", { count: group.members.length })}</span><TbChevronRight /></>} on_select={() => open_group_tab("members")} /></SettingGroup></SettingSection></SettingsContainer></SettingsMainContent></div>;
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
/** 「某个 Group 的配置」标签页的种类标识。 */
export const GROUP_TAB_KIND = "group";

/**
 * 构造「某个 Group 的配置」标签页。
 *
 * 在点击处调用，一次点击 = 一个标签页；内容自解析（只带 group_id），
 * 所以切走 Group 页后已打开的标签页依旧渲染正确内容。
 *
 * 标题用**这个 Group 的名字**，理由同 Agent 标签页：同类多开时靠对象名区分。
 */
export function group_config_tab(group: DesktopGroupSummary, controller: DesktopController, t: BayBarTranslate): BayBarTab {
  return {
    id: baybar_tab_id(GROUP_TAB_KIND, group.group_id),
    label: group.name,
    icon: <TbUsers />,
    sections: GROUP_EDITOR_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label_key ? t(item.label_key) : item.label ?? item.id,
      content: <GroupConfigTab group_id={group.group_id} section={item.id} controller={controller} />,
    })),
  };
}

/** Group 配置分区，作为域内的二级分区。 */
export const GROUP_EDITOR_SECTIONS: readonly { id: GroupEditorSection; label_key: string | null; label?: string }[] = [
  { id: "model", label_key: null, label: "Model" },
  { id: "instruction", label_key: "group_details.goal" },
  { id: "members", label_key: "group_details.members" },
];

/**
 * 「某个 Group 的配置」tab 的自解析内容。
 *
 * 只依赖 group_id 与 controller：切走 Group 页后，已打开的 tab 依旧渲染正确内容。
 * group 必须先判空再进内层：hook 不能条件调用，内层组件才能无条件地调 use_group_draft。
 */
export function GroupConfigTab({ group_id, section, controller }: {
  /** 目标 Group 标识。 */
  group_id: string;
  /** 当前编辑分区。 */
  section: GroupEditorSection;
  /** Renderer 稳定控制器。 */
  controller: DesktopController;
}) {
  const translate_common = use_translation();
  const group = use_desktop_selector(controller.stores.catalog, (state) => state.groups_by_id[group_id]);
  // Group 可能已被删除：给一个明确的空态，而不是渲染一半。
  if (!group) return <div className="px-4 py-6 text-xs leading-5 text-muted-foreground">{translate_common("state.unavailable")}</div>;
  return <GroupConfigTabContent group={group} section={section} controller={controller} />;
}

/** GroupConfigTab 的内层：group 已确定为非空，可无条件调用草稿 hook。 */
function GroupConfigTabContent({ group, section, controller }: {
  /** 当前 Group。 */
  group: DesktopGroupSummary;
  /** 当前编辑分区。 */
  section: GroupEditorSection;
  /** Renderer 稳定控制器。 */
  controller: DesktopController;
}) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const { draft, update_draft } = use_group_draft(group, controller);
  return <GroupEditorPanel group={draft} agents={agents} controller={controller} section={section} set_group={update_draft} />;
}

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

/** 按与 Agent Session Chat 完全相同的结构渲染 Group 共享消息。
 *
 * 四种行型各自对应 Session 侧的同一件事，共用同一份骨架而不是各写一遍 DOM：
 *
 * | Group 行 | 骨架 | 与 Session 的唯一差异 |
 * |---|---|---|
 * | 用户发言 | UserMessageFrame | meta 是「已读 + 时间」，没有编辑/分支操作 |
 * | Agent 发言 | AgentMessageFrame | 身份行动作是 @ 提及，不是打开配置 |
 * | 成员待响应 | AgentMessageFrame | 身份行补一句「需要你的响应」，无身份行动作 |
 * | 成员输入中 | AgentMessageFrame | 语义是 status，正文为空、只有状态行 |
 *
 * 因此这里不再写任何消息几何（头像尺寸、正文左缘、气泡圆角、元信息行高度）——
 * 那些值只能有一个来源，否则两个表面会再次分叉。
 */
const GroupMessageRow = memo(function GroupMessageRow({ message, agent, read }: { /** Group 共享消息。 */ message: DesktopGroupMessage; /** 消息所属 Agent；用户与系统消息为空。 */ agent?: DesktopAgentSummary; /** 用户消息是否已完成 Dispatch。 */ read: boolean }) {
  const translate = use_translation("resources");
  if (message.author_type === "user") return <UserMessageFrame
    meta={<>
      {read ? <span className="text-2xs text-muted-foreground">{translate("group_details.read")}</span> : null}
      <ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" />
    </>}
  >
    <div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="user" className={cn("break-words", chat_message_text_class_name)}><Markdown text={message.text} mode="static" /></div>
  </UserMessageFrame>;
  if (message.author_type === "system") return <div className="group flex w-full items-center gap-3 py-2"><span className="h-px min-w-4 flex-1 bg-border/60" /><span className="flex max-w-[80%] items-center gap-2 text-center text-xs text-muted-foreground"><span>{message.text}</span><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></span><span className="h-px min-w-4 flex-1 bg-border/60" /></div>;
  // 未知作者的降级身份：只需 id 与名称，头像会回退为默认图标。
  // 不再补 `model_id` / `version`：那两个字段只有 GroupAvatar 的降级投影需要，
  // 构造它们只会让每个调用点都要跟着写一遍。
  const identity = agent ?? { agent_id: message.author_id || "Agent" };
  return <AgentMessageFrame
    agent={identity}
    created_at={message.created_at}
    identity_action={agent ? () => dispatch_chat_mention(agent) : undefined}
    identity_title={agent ? `@${agent.name}` : undefined}
    identity_label={agent ? translate("group_details.mention", { name: agent.name }) : undefined}
  >
    <div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="agent" className={cn("min-w-0 max-w-full break-words text-foreground", chat_message_text_class_name)}><Markdown text={message.text} mode="static" /></div>
  </AgentMessageFrame>;
});

/** 待响应的 Group 成员交互；其它消息变化时保持渲染结果。 */
const GroupInteractionRow = memo(function GroupInteractionRow({ agent, agent_id, part, respond_interaction }: { /** 发起交互的 Agent。 */ agent?: DesktopAgentSummary; /** 发起交互的 Agent 标识。 */ agent_id: string; /** canonical Interaction。 */ part: SessionAgentInteraction; /** 提交交互响应。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const translate = use_translation("resources");
  // 身份行已经给出了名字，这里只说「需要你的响应」，不再重复名字。
  return <AgentMessageFrame
    agent={agent ?? { agent_id }}
    suffix={<span className="shrink-0 text-2xs text-muted-foreground">{translate("group_details.response_required")}</span>}
  >
    <AgentInteraction part={part} respond={respond_interaction} />
  </AgentMessageFrame>;
});

/** Group 成员正在生成消息时，直接在消息流中显示输入状态。 */
const GroupTypingRow = memo(function GroupTypingRow({ agent, agent_id }: { /** 正在输入的 Agent。 */ agent?: DesktopAgentSummary; /** Agent 标识。 */ agent_id: string }) {
  const translate = use_translation("resources");
  // 语义是 status 而不是 message；状态行与 Session 的「思考中」共用同一个组件。
  return <AgentMessageFrame
    agent={agent ?? { agent_id }}
    semantic="status"
    footer={<AgentThinkingStatus label={translate("group_details.typing")} />}
  />;
});


