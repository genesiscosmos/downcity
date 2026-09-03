/** 运行时 Group 共享消息视图，保持与 Agent Session Chat 一致的视觉结构。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { TbChevronDown, TbChevronRight, TbDots, TbEdit, TbFileText, TbFolder, TbLoader2, TbTrash, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { ChatMessageTimestamp } from "@/components/chat/ChatMessageTimestamp";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { SettingActionItem, SettingGroup, SettingItem, SettingSection, SettingsContainer, SettingsMainContent } from "@/components/settings/SettingComponents";
import { Switch } from "@/components/ui/switch";
import { ChatInputEditor } from "@/lib/chat/ChatInputEditor";
import { ChatTextSelectionQuote } from "@/lib/chat/ChatTextSelectionQuote";
import { ChatWorkspaceSelector } from "@/lib/chat/ChatWorkspaceSelector";
import { dispatch_chat_mention } from "@/lib/chat/editor/chatMentionEvent";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopGroupStatusPhase, DesktopSettings } from "@common/types/DesktopApi";
import type { RespondSessionInteractionInput, SessionAssistantInteractionPart } from "@downcity/agent";
import { ChatSurfaceLayout } from "@/layouts/ChatSurfaceLayout";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import type { DesktopAgentSummary, DesktopGroupMemberRuntime, DesktopGroupMessage, DesktopGroupSessionSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";
import { AssistantContent } from "@/lib/chat/assistant/AssistantActivity";
import { is_group_draft_session_id } from "@/types/DesktopView";

/** Group 定义侧栏可以编辑的分区。 */
export type GroupEditorSection = "model" | "instruction" | "members";

interface GroupViewProps {
  /** 当前运行时 Group。 */
  group: DesktopGroupSummary;
  /** 打开当前 Group 配置侧栏。 */
  open_group_info(): void;
  /** 当前 Desktop 可用 Agent。 */
  agents: DesktopAgentSummary[];
  /** Desktop Chat 设置。 */
  settings: DesktopSettings;
  /** 当前共享消息。 */
  messages: DesktopGroupMessage[];
  /** 当前 GroupSession 的成员运行态。 */
  member_statuses: DesktopGroupMemberRuntime[];
  /** 当前 GroupSession 的运行阶段。 */
  group_phase: DesktopGroupStatusPhase;
  /** 已完成 Dispatch 的用户消息标识。 */
  read_message_ids: string[];
  /** 当前待响应的成员交互。 */
  interactions: { agent_id: string; part: SessionAssistantInteractionPart }[];
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
  /** 当前 Group Chat 的完整 Tiptap 草稿。 */
  draft_content: JSONContent;
  /** 更新当前 Group Chat 的完整 Tiptap 草稿。 */
  update_draft(input: JSONContent): void;
  /** 向当前 GroupSession 发送 Tiptap Chat Input。 */
  send_message(session_id: string, input: JSONContent): Promise<string | undefined>;
  /** 停止 Group 当前执行。 */
  stop_session(session_id: string): Promise<void>;
  /** 删除当前 Group Session；草稿态不提供。 */
  remove_session?(): Promise<void>;
  /** Session Sidebar 是否折叠。 */
  session_sidebar_collapsed?: boolean;
  /** 切换 Session Sidebar。 */
  toggle_session_sidebar?(): void;
  /** Header 下方的 Session Sidebar。 */
  session_sidebar?: ReactNode;
  /** Desktop 根状态控制器。 */
  controller: DesktopViewController;
}

/** Group 复用 Agent Chat 的消息流和输入区布局，但保留共享消息语义。 */
export function GroupView({ group, open_group_info, agents, settings, messages, member_statuses, group_phase, read_message_ids, interactions, respond_interaction, session, workspace_id, workspaces, workspace_draft_mode, switch_workspace, draft_content, update_draft, send_message, stop_session, remove_session, session_sidebar, controller }: GroupViewProps) {
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scroll_ref.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, member_statuses]);

  const group_agent = agents.find((agent) => group.members.some((member) => member.agent_id === agent.agent_id)) ?? agents[0] ?? { agent_id: "group", model_id: "", version: "" };

  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  const workspace_tag = workspace_draft_mode ? <ChatWorkspaceSelector workspace_id={workspace_id} workspaces={workspaces} disabled={group_phase !== "idle"} switch_workspace={switch_workspace} /> : <span className="inline-flex h-5 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.045] px-2 text-[0.625rem] font-normal text-muted-foreground"><TbFolder className="size-3 shrink-0" /><span className="truncate">{workspace?.name || workspace_id}</span></span>;
  return <ChatSurfaceLayout sidebar={session_sidebar} header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><button type="button" onClick={open_group_info} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-interaction-hover" title="编辑 Group"><GroupAvatar group={group} agents={agents} class_name="size-5" member_class_name="size-4" /><span className="truncate">{format_group_session_title(session)}</span></button>{workspace_tag}</div>} header_right={<DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title="对话操作" aria-label="对话操作"><TbDots className="size-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_group_info}><TbEdit /><span>Group 配置</span></DropdownMenuItem>{remove_session ? <DropdownMenuItem className="text-destructive" onClick={() => { if (window.confirm("确定删除当前 Group 对话吗？")) void remove_session(); }}><TbTrash /><span>删除对话</span></DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu>}>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div ref={scroll_ref} className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log">
          <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {messages.length === 0 ? <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4"><TbUsers className="size-8 text-muted-foreground/50" /><p className="text-center text-sm text-muted-foreground">开始与 {group.name} 协作</p><p className="text-center text-xs text-muted-foreground/60">{group.members.length} 个 Agent 已加入</p></div> : null}
            {messages.map((message) => <GroupMessageRow key={message.message_id} message={message} agents={agents} read={read_message_ids.includes(message.message_id)} />)}
            {interactions.map(({ agent_id, part }) => <div key={part.interaction_id} className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agents.find((item) => item.agent_id === agent_id) ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 flex-1 px-1 pt-0.5"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{agents.find((agent) => agent.agent_id === agent_id)?.name || "Agent"} 需要你的响应</div><AssistantContent message_id={`group-interaction:${part.interaction_id}`} parts={[part]} show_reasoning={true} streaming={false} respond_interaction={respond_interaction} /></div></div>)}
            {(group_phase === "executing"
              ? member_statuses.filter((status) => status.running).map((status) => status.agent_id)
              : []).map((agent_id) => <GroupTypingRow key={`typing:${agent_id}`} agent={agents.find((item) => item.agent_id === agent_id)} agent_id={agent_id} />)}
          </div>
        </div>
        <ChatInputEditor group_mode group_members={agents.filter((agent) => group.members.some((member) => member.agent_id === agent.agent_id))} group_sessions={group.sessions} select_group_session={(session_id) => controller.open_group(group.group_id, session_id)} group_phase={group_phase} surface="agent" workspace_id={workspace_id} editor_key={session.session_id} agent={group_agent} draft_content={draft_content} queued_messages={[]} queue_paused={false} models={[]} models_loading={false} settings={settings} update_draft={update_draft} send_message={async (input) => { await send_message(session.session_id, input); }} stop_session={() => stop_session(session.session_id)} refresh_models={async () => undefined} set_model={async () => undefined} set_reasoning_effort={async () => undefined} set_approval_mode={async () => undefined} remove_queued_message={() => undefined} send_queued_message={async () => undefined} update_queued_message={() => undefined} toggle_queued_message_paused={() => undefined} set_queue_paused={() => undefined} move_queued_message={() => undefined} />
      </div>
  </ChatSurfaceLayout>;
}

/** Group 联系人主页面，只展示摘要和可进入的具体配置项。 */
export function GroupConfigView({ group, agents, open_config, sidebar, sidebar_collapsed = false, toggle_sidebar }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** 全部 Agent。 */ agents: DesktopAgentSummary[]; /** 打开具体配置项。 */ open_config(section: GroupEditorSection): void; /** Group Left Panel。 */ sidebar?: ReactNode; /** Group Left Panel 是否折叠。 */ sidebar_collapsed?: boolean; /** 切换 Group Left Panel。 */ toggle_sidebar?: () => void }) {
  const content = <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><SettingsMainContent><SettingsContainer><SettingSection title="Group" description="配置协作模型、目标与参与成员"><SettingGroup><SettingActionItem icon={<LLMModelIcon model_id={group.model_id} />} label="Model" description="用于理解意图并调度成员的模型" trailing={<><span className="max-w-48 truncate">{group.model_id || "未配置"}</span><TbChevronRight /></>} on_select={() => open_config("model")} /><SettingActionItem icon={<TbFileText />} label="协作目标" description="说明 Group 的职责和协作方式" trailing={<><span>{group.instruction ? `${group.instruction.length} 字符` : "未设置"}</span><TbChevronRight /></>} on_select={() => open_config("instruction")} /><SettingActionItem icon={<TbUsers />} label="成员" description="选择参与该 Group 的 Agent" trailing={<><span>{group.members.length} 个</span><TbChevronRight /></>} on_select={() => open_config("members")} /></SettingGroup></SettingSection></SettingsContainer></SettingsMainContent></div>;
  if (sidebar && toggle_sidebar) return <ChatSurfaceLayout sidebar={sidebar} header_left={group.name}>{content}</ChatSurfaceLayout>;
  return <MainViewLayout>
    <MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><GroupAvatar group={group} agents={agents} /><span className="truncate">{group.name}</span></span>} />
    <MainViewBody>{content}</MainViewBody>
  </MainViewLayout>;
}

/** 生成 GroupSession 的紧凑显示标题。 */
function format_group_session_title(session: DesktopGroupSessionSummary): string {
  if (is_group_draft_session_id(session.session_id)) return "新对话";
  return session.title?.trim() || "新对话";
}

/** 当前 Group 配置项的单一编辑器。 */
export function GroupInfoSidebar({ group, agents, controller, close_sidebar, section, collapsed = false, embedded = false }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** 全部 Agent。 */ agents: DesktopAgentSummary[]; /** Desktop 根状态控制器。 */ controller: DesktopViewController; /** 关闭侧栏。 */ close_sidebar(): void; /** 当前编辑分区。 */ section?: GroupEditorSection; /** 是否折叠。 */ collapsed?: boolean; /** 是否嵌入 BayBar。 */ embedded?: boolean }) {
  const [editor_section, set_editor_section] = useState<GroupEditorSection | undefined>(section || "model");
  const [draft, set_draft] = useState(group);
  const [draft_dirty, set_draft_dirty] = useState(false);
  const version_ref = useRef(0);
  useEffect(() => { if (section) set_editor_section(section); }, [section]);
  useEffect(() => { if (!draft_dirty) set_draft(group); version_ref.current += 1; }, [group.group_id, group.model_id, group.instruction, group.members, group.name]);
  useEffect(() => {
    if (!draft_dirty || draft.group_id !== group.group_id) return;
    const version = version_ref.current;
    const timeout_id = window.setTimeout(() => {
      void controller.update_group(group.group_id, {
        name: draft.name,
        model_id: draft.model_id,
        instruction: draft.instruction || "",
        member_agent_ids: draft.members.map((member) => member.agent_id),
      }).then(() => { if (version_ref.current === version) set_draft_dirty(false); }).catch(() => undefined);
    }, 500);
    return () => { window.clearTimeout(timeout_id); };
  }, [controller.update_group, draft, draft_dirty, group.group_id]);
  const update_draft = (next: DesktopGroupSummary) => { version_ref.current += 1; set_draft(next); set_draft_dirty(true); };
  const content = editor_section === "model" ? <GroupModelEditor group={draft} models={controller.models} models_loading={controller.models_loading} set_group={update_draft} /> : editor_section === "instruction" ? <textarea value={draft.instruction || ""} onChange={(event) => update_draft({ ...draft, instruction: event.target.value })} placeholder="Group 协作目标…" className="h-full min-h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-6 text-foreground outline-none" autoFocus /> : <SettingGroup>{agents.map((agent) => { const active = draft.members.some((member) => member.agent_id === agent.agent_id); return <SettingItem key={agent.agent_id} label={agent.name} leading={<AgentAvatar agent={agent} class_name="size-5 rounded" />}><Switch checked={active} disabled={active && draft.members.length === 1} onCheckedChange={(checked) => { const members = checked ? [...draft.members, { agent_id: agent.agent_id }] : draft.members.filter((member) => member.agent_id !== agent.agent_id); if (members.length > 0) update_draft({ ...draft, members }); }} aria-label={`${agent.name} 成员状态`} /></SettingItem>; })}</SettingGroup>;
  const title = editor_section === "model" ? "Model" : editor_section === "instruction" ? "协作目标" : "成员";
  if (embedded) return <div className={`h-full min-h-0 w-full ${editor_section === "instruction" ? "" : "p-2"}`}>{content}</div>;
  return <DetailEditorSidebar title={`${group.name} / ${title}`} storage_key="downcity.group_config_width" default_width={400} max_width={560} on_close={close_sidebar} collapsed={collapsed} show_close={false}>{content}</DetailEditorSidebar>;
}

function GroupModelEditor({ group, models, models_loading, set_group }: { /** 当前编辑草稿。 */ group: DesktopGroupSummary; /** 可用模型。 */ models: DesktopViewController["models"]; /** 模型目录加载态。 */ models_loading: boolean; /** 更新 Group 草稿。 */ set_group(group: DesktopGroupSummary): void }) {
  const text_models = models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  if (models_loading && text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">模型加载中…</div>;
  if (text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">暂无文本模型</div>;
  return <SettingGroup>{text_models.map((model) => <SettingActionItem key={model.model_id} icon={<LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" />} label={model.name} active={model.model_id === group.model_id} on_select={() => set_group({ ...group, model_id: model.model_id })} />)}</SettingGroup>;
}

/** 按 Agent Chat 的左右消息结构渲染 Group 共享消息。 */
function GroupMessageRow({ message, agents, read }: { /** Group 共享消息。 */ message: DesktopGroupMessage; /** 可用 Agent 列表。 */ agents: DesktopAgentSummary[]; /** 用户消息是否已完成 Dispatch。 */ read: boolean }) {
  if (message.author_type === "user") return <div className="group is-user flex w-full items-end justify-end gap-2 py-2"><div className="w-full flex justify-end"><div className="user-message-stack flex w-fit max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5"><div className="ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-sm text-foreground"><div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="user" className="whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.54]">{message.text}</div></div><div className="flex items-center gap-1.5 px-1">{read ? <span className="text-[0.6875rem] text-muted-foreground">已读</span> : null}<ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div></div></div></div>;
  if (message.author_type === "system") return <div className="group flex w-full items-center gap-3 py-2"><span className="h-px min-w-4 flex-1 bg-border/60" /><span className="flex max-w-[80%] items-center gap-2 text-center text-[0.75rem] text-muted-foreground"><span>{message.text}</span><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></span><span className="h-px min-w-4 flex-1 bg-border/60" /></div>;
  const agent = agents.find((item) => item.agent_id === message.author_id);
  return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><button type="button" disabled={!agent} onClick={() => { if (agent) dispatch_chat_mention(agent); }} className="size-8 shrink-0 rounded-md transition-opacity duration-150 enabled:hover:opacity-75" title={agent ? `@${agent.name}` : undefined} aria-label={agent ? `提及 ${agent.name}` : undefined}><AgentAvatar agent={agent ?? { agent_id: message.author_id || "Agent", model_id: "", version: "" }} class_name="size-8 rounded-md" /></button><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground"><span>{agent?.name || "Agent"}</span><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div><div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="assistant" className="max-w-full overflow-hidden rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2"><ChatMarkdown text={message.text} mode="static" class_name="text-[0.8125rem] leading-[1.54]" /></div></div></div>;
}

/** Group 成员正在生成消息时，直接在消息流中显示输入状态。 */
function GroupTypingRow({ agent, agent_id }: { /** 正在输入的 Agent。 */ agent?: DesktopAgentSummary; /** Agent 标识。 */ agent_id: string }) {
  return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agent ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{agent?.name || "Agent"}</div><div className="rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2 text-[0.8125rem] leading-[1.54] text-muted-foreground">正在输入…</div></div></div>;
}
