/** 运行时 Group 共享消息视图，保持与 Agent Session Chat 一致的视觉结构。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TbCheck, TbChevronDown, TbChevronRight, TbFileText, TbLoader2, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { ChatInputEditor } from "@/lib/chat/ChatInputEditor";
import type { DesktopViewController } from "@/types/DesktopView";
import type { DesktopChatFileInput, DesktopChatInput, DesktopChatReferenceInput, DesktopGroupStatusPhase, DesktopSettings } from "@common/types/DesktopApi";
import type { RespondSessionInteractionInput, SessionAssistantInteractionPart } from "@downcity/agent";
import { ChatSurfaceLayout } from "@/layouts/ChatSurfaceLayout";
import { MainViewBody, MainViewHeader, MainViewLayout, SessionSidebarButton } from "@/layouts/MainViewLayout";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import type { DesktopAgentSummary, DesktopGroupMemberRuntime, DesktopGroupMessage, DesktopGroupSessionSummary, DesktopGroupSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";
import { AssistantContent } from "@/lib/chat/assistant/AssistantActivity";

/** Group 定义侧栏可以编辑的分区。 */
export type GroupEditorSection = "model" | "instruction" | "members";

interface GroupViewProps {
  /** 当前运行时 Group。 */
  group: DesktopGroupSummary;
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
  /** 向当前 GroupSession 发送文本。 */
  send_message(session_id: string, text: string): Promise<string | undefined>;
  /** 停止 Group 当前执行。 */
  stop_session(session_id: string): Promise<void>;
  /** Session Sidebar 是否折叠。 */
  session_sidebar_collapsed: boolean;
  /** 切换 Session Sidebar。 */
  toggle_session_sidebar(): void;
  /** Header 下方的 Session Sidebar。 */
  session_sidebar: ReactNode;
  /** Desktop 根状态控制器。 */
  controller: DesktopViewController;
}

/** Group 复用 Agent Chat 的消息流和输入区布局，但保留共享消息语义。 */
export function GroupView({ group, agents, settings, messages, member_statuses, group_phase, read_message_ids, interactions, respond_interaction, session, workspace_id, send_message, stop_session, session_sidebar_collapsed, toggle_session_sidebar, session_sidebar, controller }: GroupViewProps) {
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const [draft, set_draft] = useState("");
  const [draft_files, set_draft_files] = useState<DesktopChatFileInput[]>([]);
  const [draft_references, set_draft_references] = useState<DesktopChatReferenceInput[]>([]);
  useEffect(() => {
    const container = scroll_ref.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, member_statuses]);

  const group_agent = agents.find((agent) => group.members.some((member) => member.agent_id === agent.agent_id)) ?? agents[0] ?? { agent_id: "group", model_id: "", version: "" };

  return <ChatSurfaceLayout sidebar={session_sidebar} header_actions={<SessionSidebarButton collapsed={session_sidebar_collapsed} toggle_collapsed={toggle_session_sidebar} />} header_left={<div className="min-w-0 max-w-[min(100%,28rem)] truncate text-xs font-medium text-foreground">{format_group_session_title(session)}</div>}>
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div ref={scroll_ref} className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto" role="log">
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {messages.length === 0 ? <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4"><TbUsers className="size-8 text-muted-foreground/50" /><p className="text-center text-sm text-muted-foreground">开始与 {group.name} 协作</p><p className="text-center text-xs text-muted-foreground/60">{group.members.length} 个 Agent 已加入</p></div> : null}
            {messages.map((message) => <GroupMessageRow key={message.message_id} message={message} agents={agents} read={read_message_ids.includes(message.message_id)} />)}
            {interactions.map(({ agent_id, part }) => <div key={part.interaction_id} className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agents.find((item) => item.agent_id === agent_id) ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 flex-1 px-1 pt-0.5"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{agent_id} 需要你的响应</div><AssistantContent parts={[part]} show_reasoning={true} streaming={false} respond_interaction={respond_interaction} /></div></div>)}
            {(group_phase === "executing"
              ? member_statuses.filter((status) => status.running).map((status) => status.agent_id)
              : []).map((agent_id) => <GroupTypingRow key={`typing:${agent_id}`} agent={agents.find((item) => item.agent_id === agent_id)} agent_id={agent_id} />)}
          </div>
        </div>
        <ChatInputEditor group_mode group_members={agents.filter((agent) => group.members.some((member) => member.agent_id === agent.agent_id))} group_sessions={group.sessions} select_group_session={(session_id) => controller.open_group(group.group_id, session_id)} group_phase={group_phase} surface="agent" workspace_id={workspace_id} editor_key={session.session_id} agent={group_agent} draft={draft} draft_files={draft_files} draft_references={draft_references} queued_messages={[]} models={[]} models_loading={false} settings={settings} update_draft={set_draft} update_draft_files={set_draft_files} update_draft_references={set_draft_references} send_message={async (input: DesktopChatInput) => { await send_message(session.session_id, input.text); set_draft(""); set_draft_files([]); set_draft_references([]); }} stop_session={() => stop_session(session.session_id)} refresh_models={async () => undefined} set_model={async () => undefined} set_reasoning_effort={async () => undefined} set_approval_mode={async () => undefined} remove_queued_message={() => undefined} move_queued_message={() => undefined} />
      </div>
  </ChatSurfaceLayout>;
}

/** Group 联系人主页面，只展示摘要和可进入的具体配置项。 */
export function GroupConfigView({ group, agents, open_config }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** 全部 Agent。 */ agents: DesktopAgentSummary[]; /** 打开具体配置项。 */ open_config(section: GroupEditorSection): void }) {
  return <MainViewLayout>
    <MainViewHeader title={<span className="flex min-w-0 items-center gap-2"><GroupAvatar group={group} agents={agents} /><span className="truncate">{group.name}</span></span>} />
    <MainViewBody>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[42rem] px-6 pb-12 pt-14">
        <div className="mb-9 flex min-w-0 items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-subtle"><GroupAvatar group={group} agents={agents} /></div><div className="min-w-0"><h1 className="truncate text-lg font-semibold text-foreground">{group.name}</h1><p className="mt-1 truncate text-xs text-muted-foreground">{group.members.length} 个 Agent 成员</p></div></div>
        <SettingsGroup title="Definition">
          <EditablePropertyRow icon={<LLMModelIcon model_id={group.model_id} />} label="Model" value={group.model_id || "未配置"} active={false} on_select={() => open_config("model")} />
          <EditablePropertyRow icon={<TbFileText />} label="目标" value={group.instruction ? `${group.instruction.length} characters` : "未设置"} active={false} on_select={() => open_config("instruction")} />
          <EditablePropertyRow icon={<TbUsers />} label="成员" value={`${group.members.length} 个 Agent`} active={false} on_select={() => open_config("members")} last />
        </SettingsGroup>
      </div></div>
    </MainViewBody>
  </MainViewLayout>;
}

/** 生成 GroupSession 的紧凑显示标题。 */
function format_group_session_title(session: DesktopGroupSessionSummary): string {
  return session.preview_text?.trim().slice(0, 36) || `Session ${session.session_id.slice(0, 8)}`;
}

/** BayBar 中当前 Group 配置项的单一编辑器。 */
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
  const content = editor_section === "model" ? <GroupModelEditor group={draft} models={controller.models} models_loading={controller.models_loading} set_group={update_draft} /> : editor_section === "instruction" ? <textarea value={draft.instruction || ""} onChange={(event) => update_draft({ ...draft, instruction: event.target.value })} placeholder="Group 协作目标…" className="min-h-full w-full resize-none bg-background px-2 py-1 font-mono text-xs leading-6 text-foreground outline-none" autoFocus /> : <div className="space-y-1">{agents.map((agent) => { const active = draft.members.some((member) => member.agent_id === agent.agent_id); return <label key={agent.agent_id} className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-xs hover:bg-interaction-hover"><input type="checkbox" checked={active} onChange={(event) => { const members = event.target.checked ? [...draft.members, { agent_id: agent.agent_id }] : draft.members.filter((member) => member.agent_id !== agent.agent_id); if (members.length > 0) update_draft({ ...draft, members }); }} /><AgentAvatar agent={agent} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">{agent.agent_id}</span></label>; })}</div>;
  return <DetailEditorSidebar title={`${group.name} / ${editor_section === "model" ? "Model" : editor_section === "instruction" ? "目标" : "成员"}`} storage_key="downcity.group_config_width" default_width={400} max_width={560} on_close={close_sidebar} collapsed={collapsed} show_close={false} embedded={embedded}>{content}</DetailEditorSidebar>;
}

function GroupModelEditor({ group, models, models_loading, set_group }: { /** 当前编辑草稿。 */ group: DesktopGroupSummary; /** 可用模型。 */ models: DesktopViewController["models"]; /** 模型目录加载态。 */ models_loading: boolean; /** 更新 Group 草稿。 */ set_group(group: DesktopGroupSummary): void }) {
  const text_models = models.filter((model) => model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality)));
  if (models_loading && text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">模型加载中…</div>;
  if (text_models.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">暂无文本模型</div>;
  return <div className="-mx-3 divide-y divide-border/45 border-y border-border/45">{text_models.map((model) => { const active = model.model_id === group.model_id; return <button key={model.model_id} type="button" onClick={() => set_group({ ...group, model_id: model.model_id })} aria-pressed={active} className={cn("group flex min-h-10 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-interaction-hover", active && "bg-interaction-selected hover:bg-interaction-active")}><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">{model.name}</span><TbCheck className={cn("size-4 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-0")} /></button>; })}</div>;
}

function GroupAvatar({ group, agents }: { /** Group 摘要。 */ group: DesktopGroupSummary; /** Agent 列表。 */ agents: DesktopAgentSummary[] }) {
  const member = agents.find((agent) => agent.agent_id === group.members[0]?.agent_id);
  return member ? <AgentAvatar agent={member} class_name="size-8 rounded-lg" /> : <TbUsers className="size-8 rounded-lg bg-foreground/[0.06] p-1.5 text-muted-foreground" />;
}

function SettingsGroup({ title, children }: { /** 分组标题。 */ title: string; /** 分组内容。 */ children: React.ReactNode }) { return <section className="mb-7"><h2 className="mb-2 px-1 text-xs font-semibold text-foreground">{title}</h2><div className="overflow-hidden rounded-lg bg-surface-subtle">{children}</div></section>; }

function EditablePropertyRow({ icon, label, value, active, on_select, last = false }: { /** 属性图标。 */ icon: React.ReactNode; /** 属性名称。 */ label: string; /** 属性值。 */ value: string; /** 是否激活。 */ active: boolean; /** 打开编辑器。 */ on_select(): void; /** 是否最后一行。 */ last?: boolean }) { return <button type="button" className={`grid min-h-11 w-full grid-cols-[1rem_4rem_minmax(0,1fr)_1rem] items-center gap-3 px-3.5 text-left transition-colors ${active ? "bg-primary/[0.08]" : "hover:bg-foreground/[0.04]"} ${last ? "" : "border-b border-border/45"}`} onClick={on_select}><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[0.6875rem] text-muted-foreground">{label}</span><span className="truncate text-right text-[0.6875rem] text-foreground/80">{value}</span><TbChevronRight className="size-3.5 text-muted-foreground" /></button>; }

/** 按 Agent Chat 的左右消息结构渲染 Group 共享消息。 */
function GroupMessageRow({ message, agents, read }: { /** Group 共享消息。 */ message: DesktopGroupMessage; /** 可用 Agent 列表。 */ agents: DesktopAgentSummary[]; /** 用户消息是否已完成 Dispatch。 */ read: boolean }) {
  if (message.author_type === "user") return <div className="group is-user flex w-full items-end justify-end gap-2 py-2"><div className="w-full flex justify-end"><div className="user-message-stack flex w-fit max-w-[min(80%,42rem)] min-w-0 flex-col items-end gap-0.5"><div className="ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 px-3 py-2 text-sm text-foreground"><div className="whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.54]">{message.text}</div></div>{read ? <div className="px-1 text-[0.6875rem] text-muted-foreground">已读</div> : null}</div></div></div>;
  if (message.author_type === "system") return <div className="flex w-full items-center gap-3 py-2"><span className="h-px min-w-4 flex-1 bg-border/60" /><span className="max-w-[80%] text-center text-[0.75rem] text-muted-foreground">{message.text}</span><span className="h-px min-w-4 flex-1 bg-border/60" /></div>;
  const agent = agents.find((item) => item.agent_id === message.author_id);
  return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agent ?? { agent_id: message.author_id || "Agent", model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{message.author_id || "Agent"}</div><div className="max-w-full overflow-hidden rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2"><ChatMarkdown text={message.text} mode="static" class_name="text-[0.8125rem] leading-[1.54]" /></div></div></div>;
}

/** Group 成员正在生成消息时，直接在消息流中显示输入状态。 */
function GroupTypingRow({ agent, agent_id }: { /** 正在输入的 Agent。 */ agent?: DesktopAgentSummary; /** Agent 标识。 */ agent_id: string }) {
  return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2"><div className="size-8 shrink-0"><AgentAvatar agent={agent ?? { agent_id, model_id: "", version: "" }} class_name="size-8 rounded-md" /></div><div className="min-w-0 max-w-[min(80%,42rem)] px-1 pt-0.5 text-sm text-foreground"><div className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">{agent_id}</div><div className="rounded-2xl rounded-tl-none bg-muted-foreground/10 px-3 py-2 text-[0.8125rem] leading-[1.54] text-muted-foreground">正在输入…</div></div></div>;
}
