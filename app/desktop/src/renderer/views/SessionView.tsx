/** Downcity Session Chat 主视图，交互语义与 Duobox ChatCore 保持一致。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionMessage } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import {
  TbArrowUp,
  TbAlertTriangle,
  TbChecklist,
  TbCheck,
  TbChevronDown,
  TbCopy,
  TbDots,
  TbFile,
  TbFolder,
  TbGitBranch,
  TbLoader2,
  TbMessageReply,
  TbPencil,
  TbRoute,
  TbSearch,
  TbUserCircle,
  TbWriting,
} from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChatMessageTimestamp } from "@/components/chat/ChatMessageTimestamp";
import { AssistantContent } from "@/lib/chat/assistant/AssistantActivity";
import { should_show_assistant_actions } from "@/lib/chat/assistant/assistant_activity";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import { ChatInputEditor } from "@/lib/chat/ChatInputEditor";
import { ChatTextSelectionQuote } from "@/lib/chat/ChatTextSelectionQuote";
import { ChatWorkspaceSelector } from "@/lib/chat/ChatWorkspaceSelector";
import { dispatch_chat_reference } from "@/lib/chat/editor/chatReferenceEvent";
import { create_chat_composer } from "@/lib/chat/editor/chatComposerCodec";
import { resolve_user_message_rewrite } from "@/lib/chat/user_message_rewrite";
import { ChatSurfaceLayout } from "@/layouts/ChatSurfaceLayout";
import { cn } from "@/lib/utils";
import { is_chat_busy, type ChatHistoryState, type ChatSubmitMode, type QueuedChatMessage } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatRewriteAction, DesktopChatRewriteInput, DesktopChatRuntime, DesktopModelSummary, DesktopSessionConfiguration, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Session Chat 主视图属性。 */
interface SessionViewProps {
  /** 当前 Chat 的 UI 表面。 */
  chat_surface?: "agent" | "workspace";
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** Session 所属 Agent。 */
  agent: DesktopAgentSummary;
  /** Session 所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** 可切换的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前是否为尚未创建的 Session 草稿。 */
  workspace_draft_mode?: boolean;
  /** 在目标 Workspace 开启新对话。 */
  switch_workspace(workspace_id: string): Promise<void> | void;
  /** 可切换的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 打开当前 Agent 信息侧栏。 */
  open_agent_info?(): void;
  /** Session Sidebar 是否折叠。 */
  session_sidebar_collapsed?: boolean;
  /** 切换 Session Sidebar。 */
  toggle_session_sidebar?(): void;
  /** Header 下方的 Session Sidebar。 */
  session_sidebar?: ReactNode;
  /** 当前 Session 的 canonical 可见消息。 */
  messages: SessionMessage[];
  /** 当前 Session 实时运行态。 */
  runtime?: DesktopChatRuntime;
  /** 当前 Session 的完整 Tiptap 输入草稿。 */
  draft_content: JSONContent;
  /** 当前 Session 待发送队列。 */
  queued_messages: QueuedChatMessage[];
  /** 当前 Session 的队列是否整体暂停。 */
  queue_paused: boolean;
  /** 当前 Session 更早历史分页状态。 */
  history?: ChatHistoryState;
  /** Desktop Chat 设置。 */
  settings: DesktopSettings;
  /** 修改当前 Session 标题。 */
  rename_session?(title: string): Promise<void>;
  /** 归档当前 Session。 */
  archive_session?(): Promise<void>;
  /** 删除当前 Session。 */
  remove_session?(): Promise<void>;
  /** 切换新建 Chat 的 Workspace 或 Agent。 */
  switch_draft_context(workspace_id: string, agent_id: string): void;
  /** 当前 Federation 模型目录。 */
  models: DesktopModelSummary[];
  /** 当前 Session 模型与审批配置。 */
  configuration?: DesktopSessionConfiguration;
  /** 模型目录是否正在读取。 */
  models_loading: boolean;
  /** 更新当前完整的 Tiptap 输入草稿。 */
  update_draft(input: JSONContent): void;
  /** 按指定意图立即发送或加入下一轮队列。 */
  send_message(input: JSONContent, mode?: ChatSubmitMode): Promise<void>;
  /** 请求压缩当前 Session 历史上下文。 */
  compact_session?(): Promise<void>;
  /** 刷新模型目录。 */
  refresh_models(): Promise<void>;
  /** 切换当前模型。 */
  set_model(model_id: string): Promise<void>;
  /** 切换推理强度。 */
  set_reasoning_effort(reasoning_effort?: string): Promise<void>;
  /** 切换当前审批模式。 */
  set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 停止当前 Turn。 */
  stop_session(): Promise<void>;
  /** 响应当前审批或问题。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
  /** 从指定消息创建并打开分支 Session。 */
  fork_message(message_id: string): Promise<void>;
  /** 重写指定历史用户消息。 */
  rewrite_message?(input: DesktopChatRewriteInput): Promise<void>;
  /** 删除尚未发送的队列项。 */
  remove_queued_message(message_id: string): void;
  /** 立即提交指定队列项；Session 运行中时作为 steer。 */
  send_queued_message(message_id: string): Promise<void>;
  /** 修改指定队列项的文本。 */
  update_queued_message(message_id: string, text: string): void;
  /** 切换指定队列项的暂停状态。 */
  toggle_queued_message_paused(message_id: string): void;
  /** 设置整个队列的暂停状态。 */
  set_queue_paused(paused: boolean): void;
  /** 调整尚未发送的队列项顺序。 */
  move_queued_message(message_id: string, direction: "up" | "down"): void;
  /** 读取一个更早历史 Segment。 */
  load_earlier_history(): Promise<void>;
}

const empty_prompts = [
  { title: "写作与创作", description: "帮助我完善一段文字或构思", icon: TbWriting, prompt: "帮我完善一段文字" },
  { title: "研究与分析", description: "整理信息并提炼关键结论", icon: TbSearch, prompt: "帮我分析这个问题" },
  { title: "规划项目", description: "把目标拆解成可执行的步骤", icon: TbRoute, prompt: "帮我规划一个执行方案" },
  { title: "团队协作", description: "一起梳理任务、方案和下一步", icon: TbChecklist, prompt: "帮我梳理下一步任务" },
];

/** Session 对话主视图。 */
export function SessionView(props: SessionViewProps) {
  const { session, messages, runtime, settings } = props;
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const sticky_ref = useRef(true);
  const busy = is_chat_busy(runtime);
  const can_compact = Boolean(props.compact_session && messages.some((message) => message.type === "user" || message.type === "assistant"));

  useEffect(() => {
    const container = scroll_ref.current;
    if (!container || !settings.auto_scroll || !sticky_ref.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, runtime?.status, settings.auto_scroll]);

  const load_earlier = async () => {
    const container = scroll_ref.current;
    const previous_height = container?.scrollHeight ?? 0;
    await props.load_earlier_history();
    requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - previous_height;
    });
  };

  const workspace_tag = props.workspace_draft_mode ? <ChatWorkspaceSelector workspace_id={props.workspace_id} workspaces={props.workspaces} disabled={busy} switch_workspace={props.switch_workspace} /> : <StaticWorkspaceTag workspace={props.workspace} />;
  return <ChatSurfaceLayout sidebar={props.session_sidebar} header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><button type="button" disabled={!props.open_agent_info} onClick={props.open_agent_info} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-foreground transition-colors duration-150 enabled:hover:bg-interaction-hover" title={props.open_agent_info ? "编辑 Agent" : undefined}><AgentAvatar agent={props.agent} class_name="size-5 rounded-md" /><span className="truncate">{session.title || "新对话"}</span></button>{workspace_tag}</div>} header_right={<div className="flex shrink-0 items-center gap-1">
      {is_agent_typing(runtime?.status) ? <span className="mr-1 flex items-center gap-1 text-[10px] text-primary"><span className="thinking-dots-icon is-highlighted" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span>正在回复</span> : null}
        {props.rename_session && props.archive_session && props.remove_session ? <SessionActionsMenu session={session} on_rename={props.rename_session} on_archive={props.archive_session} on_remove={props.remove_session} trigger={<button type="button" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title="对话操作" aria-label="对话操作"><TbDots className="size-4" /></button>} /> : null}
      </div>}
    >
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div
          ref={scroll_ref}
          className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          role="log"
          onScroll={(event) => {
            const element = event.currentTarget;
            sticky_ref.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
        >
          <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {props.history?.has_more ? <div className="flex justify-center py-1"><Button disabled={props.history.loading} onClick={() => void load_earlier()}><TbArrowUp />{props.history.loading ? "正在加载…" : "加载更早消息"}</Button></div> : null}
            {messages.length === 0 ? <EmptyPrompts surface={props.chat_surface} agent={props.agent} workspace={props.workspace} workspaces={props.workspaces} agents={props.agents} switch_context={props.switch_draft_context} on_select={(text) => props.update_draft(create_chat_composer(text))} /> : null}
            {messages.map((message, index) => message.type === "action" && action_belongs_to_assistant(messages, index) ? null : <MessageRenderer key={message.message_id} message={message} actions={message.type === "assistant" ? collect_adjacent_actions(messages, index) : []} agent={props.agent} open_agent_info={props.open_agent_info} show_reasoning={settings.show_reasoning} respond_interaction={props.respond_interaction} fork_message={props.fork_message} rewrite_message={props.rewrite_message} is_last_message={index === messages.length - 1} can_use_history_actions={!busy} />)}
            {busy && !has_streaming_assistant(messages) ? <ActivityIndicator agent={props.agent} status={runtime?.status} /> : null}
          </div>
        </div>

        <div className="flex w-full flex-none flex-col">
          <ChatInputEditor
              surface={props.chat_surface}
              workspace_id={props.workspace_id}
              editor_key={session.session_id}
              agent={props.agent}
              draft_content={props.draft_content}
              runtime={props.runtime}
              queued_messages={props.queued_messages}
              queue_paused={props.queue_paused}
              configuration={props.configuration}
              models={props.models}
              models_loading={props.models_loading}
              settings={props.settings}
              update_draft={props.update_draft}
              send_message={props.send_message}
              compact_session={can_compact ? props.compact_session : undefined}
              stop_session={props.stop_session}
              refresh_models={props.refresh_models}
              set_model={props.set_model}
              set_reasoning_effort={props.set_reasoning_effort}
              set_approval_mode={props.set_approval_mode}
              remove_queued_message={props.remove_queued_message}
              send_queued_message={props.send_queued_message}
              update_queued_message={props.update_queued_message}
              toggle_queued_message_paused={props.toggle_queued_message_paused}
              set_queue_paused={props.set_queue_paused}
              move_queued_message={props.move_queued_message}
          />
        </div>
      </div>
  </ChatSurfaceLayout>;
}

/** 已创建 Session 的只读 Workspace 标签。 */
function StaticWorkspaceTag({ workspace }: { /** 当前 Session 绑定的 Workspace。 */ workspace: DesktopWorkspaceSummary }) {
  return <span className="inline-flex h-5 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.045] px-2 text-[0.625rem] font-normal text-muted-foreground"><TbFolder className="size-3 shrink-0" /><span className="truncate">{workspace.name}</span></span>;
}

/** 顶部仅在 Agent 实际生成内容时显示输入状态。 */
function is_agent_typing(status: DesktopChatRuntime["status"] | undefined): boolean {
  return status === "submitted" || status === "streaming";
}

/** 空会话提示。 */
function EmptyPrompts({ surface = "workspace", agent, workspace, workspaces, agents, switch_context, on_select }: { /** 当前 Chat 表面。 */ surface?: "agent" | "workspace"; /** 当前联系人 Agent。 */ agent: DesktopAgentSummary; /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 切换新对话上下文。 */ switch_context(workspace_id: string, agent_id: string): void; /** 将预设提示放入输入框。 */ on_select(prompt: string): void }) {
  if (surface === "workspace") return <div className="flex min-h-[50vh] items-center justify-center px-4"><NewChatContextSelector workspace={workspace} workspaces={workspaces} agent={agent} agents={agents} switch_context={switch_context} /></div>;
  return <div className="flex min-h-[56vh] flex-col items-center justify-center px-4">
    <div className="flex flex-col items-center gap-2.5">
      <AgentAvatar agent={agent} class_name="size-14 rounded-2xl" icon_class_name="size-7" />
      <div className="text-center text-sm font-medium text-foreground">{agent.name}</div>
    </div>
    <div className="mt-10">
      <ChatWorkspaceSelector workspace_id={workspace.workspace_id} workspaces={workspaces} disabled={false} variant="field" switch_workspace={(workspace_id) => switch_context(workspace_id, agent.agent_id)} />
    </div>
  </div>;
}

/** 按 canonical 消息类型渲染。 */
function MessageRenderer({ message, actions, agent, open_agent_info, show_reasoning, respond_interaction, fork_message, rewrite_message, is_last_message, can_use_history_actions }: { /** canonical 消息。 */ message: SessionMessage; /** 紧邻当前 Assistant 的动作消息。 */ actions: Extract<SessionMessage, { type: "action" }>[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 是否是当前消息列表最后一条。 */ is_last_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean }) {
  if (message.type === "error") return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2 !m-0 !p-0">
    <div className="size-8 shrink-0 px-1" aria-hidden="true" />
    <div className="min-w-0 flex-1 px-1 pt-0.5 text-sm text-foreground">
      <div className="flex min-w-0 w-full items-start gap-2 rounded-md bg-foreground/[0.045] px-2.5 py-2">
        <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.78125rem] leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{message.message}</p>
      </div>
    </div>
  </div>;
  if (message.type === "action") return <AgentActionMessages actions={[message]} agent={agent} open_agent_info={open_agent_info} />;
  if (message.type === "user") return <UserMessage message={message} fork_message={fork_message} rewrite_message={rewrite_message} is_last_message={is_last_message} can_use_history_actions={can_use_history_actions} />;
  return <AssistantMessage message={message} actions={actions} agent={agent} open_agent_info={open_agent_info} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} />;
}

/** 用户消息及其引用、分支操作。 */
function UserMessage({ message, fork_message, rewrite_message, is_last_message, can_use_history_actions }: { /** canonical 用户消息。 */ message: Extract<SessionMessage, { type: "user" }>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 是否是消息列表最后一条。 */ is_last_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean }) {
  const [forking, set_forking] = useState(false);
  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  const [editing, set_editing] = useState(false);
  const [edit_text, set_edit_text] = useState(text);
  const [submitting, set_submitting] = useState(false);
  const [rewrite_error, set_rewrite_error] = useState("");
  const [choice_open, set_choice_open] = useState(false);
  const fork = async () => {
    if (forking || !can_use_history_actions) return;
    set_forking(true);
    try { await fork_message(message.message_id); } finally { set_forking(false); }
  };
  const start_editing = () => {
    set_edit_text(text);
    set_rewrite_error("");
    set_editing(true);
  };
  const cancel_editing = () => {
    set_edit_text(text);
    set_rewrite_error("");
    set_editing(false);
  };
  const submit_rewrite = async (action: DesktopChatRewriteAction) => {
    const normalized_text = edit_text.trim();
    if (!normalized_text) {
      set_rewrite_error("编辑后的消息不能为空");
      return;
    }
    if (!rewrite_message || submitting) return;
    set_choice_open(false);
    set_rewrite_error("");
    set_submitting(true);
    try {
      await rewrite_message({ message_id: message.message_id, text: normalized_text, action });
      set_editing(false);
    } catch (reason) {
      set_rewrite_error(reason instanceof Error ? reason.message : "消息发送失败，请重试");
    } finally {
      set_submitting(false);
    }
  };
  const confirm_editing = () => {
    if (!edit_text.trim()) {
      set_rewrite_error("编辑后的消息不能为空");
      return;
    }
    if (resolve_user_message_rewrite(is_last_message) === "rollback") void submit_rewrite("rollback");
    else set_choice_open(true);
  };
  return <div className="group is-user flex w-full items-end justify-end gap-2 py-2">
    <div className="w-full flex justify-end">
      <div className={cn("user-message-stack flex w-full min-w-0 flex-col items-end gap-0.5", editing ? "max-w-[42rem]" : "max-w-[min(80%,42rem)]")}>
        <div className={cn("ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 text-sm text-foreground", editing ? "w-full p-2" : "w-fit px-3 py-2")}>
          {editing ? <>
            <textarea
              autoFocus
              value={edit_text}
              disabled={submitting}
              rows={Math.min(8, Math.max(2, edit_text.split("\n").length))}
              className="min-h-16 max-h-52 w-full resize-y bg-transparent px-1 py-0.5 text-[0.8125rem] leading-[1.4] text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => { set_edit_text(event.target.value); if (rewrite_error) set_rewrite_error(""); }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !submitting) cancel_editing();
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); confirm_editing(); }
              }}
            />
            {rewrite_error ? <p className="px-1 text-right text-[0.6875rem] leading-4 text-destructive">{rewrite_error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button disabled={submitting} onClick={cancel_editing}>取消</Button>
              <Button variant="primary" disabled={submitting} onClick={confirm_editing}>{submitting ? <TbLoader2 className="animate-spin" /> : null}{submitting ? "正在发送" : "发送"}</Button>
            </div>
          </> : <>
          {message.parts.flatMap((part) => part.type === "context" && part.tag === "reference" ? [<div key={part.part_id} className="max-w-full border-l-2 border-foreground/15 pl-2 text-[0.75rem] text-muted-foreground"><ChatMarkdown class_name="!h-auto !w-auto break-words" text={part.context} mode="static" /></div>] : [])}
          {text ? <div data-chat-selectable-message data-chat-message-id={message.message_id} data-chat-message-role="user" className="text-[0.8125rem] leading-[1.34]"><ChatMarkdown class_name="user-message-markdown !h-auto !w-auto break-words" text={text} mode="static" /></div> : null}
          {message.parts.flatMap((part) => part.type === "file" ? [<a key={part.part_id} href={part.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-[0.75rem] text-foreground/80"><TbFile className="size-3.5 shrink-0" /><span className="truncate">{part.filename || "文件"}</span></a>] : [])}
          </>}
        </div>
        {!editing ? <div className="flex h-5 items-center gap-1"><ChatMessageTimestamp created_at={message.created_at} class_name="mr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /><span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {text && rewrite_message ? <MessageActionButton title="编辑" disabled={!can_use_history_actions} on_click={start_editing}><TbPencil /></MessageActionButton> : null}
          <MessageActionButton title="创建分支" disabled={forking || !can_use_history_actions} on_click={() => void fork()}>{forking ? <TbLoader2 className="animate-spin" /> : <TbGitBranch />}</MessageActionButton>
          </span>
        </div> : null}
      </div>
    </div>
    <Dialog open={choice_open} onOpenChange={set_choice_open}>
      <DialogContent size="sm">
        <DialogHeader><div><DialogTitle>如何处理后续消息？</DialogTitle><DialogDescription>这条消息之后已有对话内容。请选择保留为分支，或用编辑后的消息替换当前对话。</DialogDescription></div></DialogHeader>
        <DialogBody className="gap-2">
          <button type="button" disabled={submitting} onClick={() => void submit_rewrite("fork")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left hover:bg-foreground/[0.04]"><TbGitBranch className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">创建分支对话</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">保留当前对话，在新的分支中发送编辑后的消息。</span></span></button>
          <button type="button" disabled={submitting} onClick={() => void submit_rewrite("rollback")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left hover:bg-foreground/[0.04]"><TbRoute className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">删除后续消息</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">归档当前对话，并从编辑后的消息继续。</span></span></button>
        </DialogBody>
        <DialogFooter><Button disabled={submitting} onClick={() => set_choice_open(false)}>取消</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

/** Assistant 消息按 Duobox 规则展示内容、活动流和尾部操作栏。 */
function AssistantMessage({ message, actions, agent, open_agent_info, show_reasoning, respond_interaction, fork_message }: { /** canonical Assistant 消息。 */ message: Extract<SessionMessage, { type: "assistant" }>; /** 归属于当前回复的动作消息。 */ actions: Extract<SessionMessage, { type: "action" }>[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void> }) {
  const [copied, set_copied] = useState(false);
  const [forking, set_forking] = useState(false);
  const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  const show_actions = should_show_assistant_actions(message.parts);
  const copy_message = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  const fork = async () => {
    if (forking) return;
    set_forking(true);
    try { await fork_message(message.message_id); } finally { set_forking(false); }
  };
  return <div className="group is-assistant flex w-full items-start gap-2 py-2 !m-0 !p-0">
    <button type="button" disabled={!open_agent_info} onClick={open_agent_info} className="sticky top-2 z-10 shrink-0 rounded-md px-1 pt-0.5 transition-opacity duration-150 enabled:hover:opacity-75" title={open_agent_info ? "编辑 Agent" : undefined} aria-label={open_agent_info ? `编辑 ${agent.name}` : undefined}>
      <AgentAvatar agent={agent} class_name="size-7 rounded-md" />
    </button>
    <div className="flex min-w-0 flex-1 flex-col gap-0 overflow-visible rounded-none pb-0 pt-0.5 text-sm text-foreground">
      <div className="mb-1 flex min-w-0 items-center gap-2"><button type="button" disabled={!open_agent_info} onClick={open_agent_info} className="min-w-0 truncate text-xs font-medium text-foreground/85 transition-colors duration-150 enabled:hover:text-foreground enabled:hover:underline">{agent.name}</button><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div>
      <div className="min-h-0 w-full">
        <AssistantContent message_id={message.message_id} parts={message.parts} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.status === "streaming"} />
      </div>
      {actions.length > 0 ? <ActionMessageList actions={actions} /> : null}
      {message.status === "streaming" ? <ActivityIndicator status="streaming" compact /> : show_actions ? <div className="assistant-message-menu-bar flex h-6 min-h-6 shrink-0 items-center">
        {text ? <div className="message-action-toolbar pointer-events-none flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <MessageActionButton title="复制" on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title="更多操作" aria-label="更多操作"><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "assistant", text })}><TbMessageReply className="size-3.5" /><span>引用到输入框</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{forking ? "正在创建分支" : "创建分支"}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div> : null}
      </div> : null}
    </div>
  </div>;
}

/** 收集紧邻 Assistant 的动作消息，保持 canonical 消息列表不变。 */
function collect_adjacent_actions(messages: SessionMessage[], assistant_index: number): Extract<SessionMessage, { type: "action" }>[] {
  const actions: Extract<SessionMessage, { type: "action" }>[] = [];
  for (let index = assistant_index + 1; messages[index]?.type === "action"; index += 1) actions.push(messages[index] as Extract<SessionMessage, { type: "action" }>);
  return actions;
}

/** 判断动作是否属于它前方连续动作链对应的 Assistant。 */
function action_belongs_to_assistant(messages: SessionMessage[], action_index: number): boolean {
  let previous_index = action_index - 1;
  while (messages[previous_index]?.type === "action") previous_index -= 1;
  return messages[previous_index]?.type === "assistant";
}

/** 在 Agent 消息内部展示动作记录。 */
function ActionMessageList({ actions }: { /** 按发生顺序排列的动作消息。 */ actions: Extract<SessionMessage, { type: "action" }>[] }) {
  return <div className="mt-1 flex flex-col gap-0.5 border-l border-border/50 pl-2">{actions.map((action) => <div key={action.message_id} className="flex min-w-0 items-baseline gap-1.5 text-[0.6875rem] leading-4 text-foreground/75"><span className="font-medium">{action.title}</span>{action.description ? <span className="min-w-0 truncate text-muted-foreground">{action.description}</span> : null}<ChatMessageTimestamp created_at={action.created_at} class_name="ml-auto opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div>)}</div>;
}

/** 为没有前置回复的动作提供最小 Agent 消息容器。 */
function AgentActionMessages({ actions, agent, open_agent_info }: { /** 待展示的动作消息。 */ actions: Extract<SessionMessage, { type: "action" }>[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void }) {
  return <div className="group is-assistant flex w-full items-start gap-2 py-2"><button type="button" disabled={!open_agent_info} onClick={open_agent_info} className="shrink-0 rounded-md px-1 transition-opacity duration-150 enabled:hover:opacity-75"><AgentAvatar agent={agent} class_name="size-7 rounded-md" /></button><div className="min-w-0 flex-1 px-1"><div className="mb-1 text-xs font-medium text-foreground/85">{agent.name}</div><ActionMessageList actions={actions} /></div></div>;
}

const message_action_button_class_name = "group/message-action flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]";

/** 消息下方的紧凑图标操作按钮。 */
function MessageActionButton({ title, disabled, on_click, children }: { /** 操作提示。 */ title: string; /** 是否禁用。 */ disabled?: boolean; /** 执行动作。 */ on_click(): void; /** 操作图标。 */ children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={on_click} className={message_action_button_class_name} title={title} aria-label={title}>{children}</button>;
}

/** 新建 Chat 输入框上方的当前上下文。 */
function NewChatContextSelector({ workspace, workspaces, agent, agents, switch_context }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 提交上下文切换。 */ switch_context(workspace_id: string, agent_id: string): void }) {
  return <div className="flex min-w-0 max-w-full flex-col items-center gap-4">
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="group flex min-w-0 max-w-full flex-col items-center gap-2 rounded-xl px-5 py-3 transition-colors hover:bg-foreground/[0.05]" aria-label="选择联系人"><AgentAvatar agent={agent} class_name="size-14 rounded-2xl" /><span className="flex max-w-64 items-center gap-1.5 text-base font-medium text-foreground"><span className="truncate">{agent.name}</span><TbChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></span><span className="text-xs text-muted-foreground">联系人</span></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{agents.map((item) => <DropdownMenuItem key={item.agent_id} is_selected={item.agent_id === agent.agent_id} onClick={() => switch_context(workspace.workspace_id, item.agent_id)}><AgentAvatar agent={item} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.agent_id === agent.agent_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-w-0 max-w-72 items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground" aria-label="选择 Workspace"><TbFolder className="size-4 shrink-0" /><span className="truncate">{workspace.name}</span><TbChevronDown className="size-3.5 shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{workspaces.map((item) => <DropdownMenuItem key={item.workspace_id} is_selected={item.workspace_id === workspace.workspace_id} onClick={() => switch_context(item.workspace_id, agent.agent_id)}><TbFolder className="size-4" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.workspace_id === workspace.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <span className="text-[0.6875rem] text-muted-foreground/70">选择联系人和 Workspace 开始对话</span>
  </div>;
}

/** 运行活动提示。 */
function ActivityIndicator({ agent, status, compact = false }: { /** 当前 Agent；非 compact 状态下用于显示身份。 */ agent?: DesktopAgentSummary; /** 运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入消息。 */ compact?: boolean }) {
  const status_content = <span className="activity-tool-main h-5"><span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span><span className="thinking-status-label">{status === "submitted" ? "正在提交" : status === "waiting_input" ? "等待输入" : "正在思考"}</span></span>;
  if (compact || !agent) return <div className="assistant-message-menu-bar flex h-6 min-h-6 items-center pl-1">{status_content}</div>;
  return <div className="group is-assistant flex w-full items-start gap-2 py-2 !m-0 !p-0">
    <div className="shrink-0 px-1 pt-0.5"><AgentAvatar agent={agent} class_name="size-7 rounded-md" /></div>
    <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-visible pt-0.5 text-sm text-foreground">
      <div className="min-w-0 truncate text-xs font-medium text-foreground/85">{agent.name}</div>
      <div className="assistant-message-menu-bar flex items-center">{status_content}</div>
    </div>
  </div>;
}

/** 判断当前已有 streaming assistant。 */
function has_streaming_assistant(messages: SessionMessage[]): boolean {
  return messages.some((message) => message.type === "assistant" && message.status === "streaming");
}
