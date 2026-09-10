/** Downcity Session Chat 主视图，交互语义与 Duobox ChatCore 保持一致。 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import { TbArrowUp, TbAlertTriangle, TbChecklist, TbCheck, TbChevronDown, TbCopy, TbDots, TbFolder, TbGitBranch, TbLoader2, TbMessageReply, TbPencil, TbRoute, TbSearch, TbWriting } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { AssistantContent } from "@/features/chat/components/messages/AssistantActivity";
import { TurnFileOpenProvider } from "@/features/chat/components/messages/TurnFileDiffCard";
import { should_show_assistant_actions } from "@/features/chat/lib/assistant/assistant_activity";
import { ChatMessageViewportRow } from "@/features/chat/components/ChatMessageViewportRow";
import { ChatTextSelectionQuote } from "@/features/chat/components/ChatTextSelectionQuote";
import { UserMessageContent } from "@/features/chat/components/UserMessageContent";
import { UserMessageRewriteEditor } from "@/features/chat/components/UserMessageRewriteEditor";
import { ChatWorkspaceSelector } from "@/features/chat/components/ChatWorkspaceSelector";
import { WorkspaceTagMenu } from "@/features/chat/components/WorkspaceTagMenu";
import { use_chat_scroll } from "@/features/chat/lib/use_chat_scroll";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { project_session_message_segments } from "@/features/chat/lib/session_message_projection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { resolve_user_message_rewrite } from "@/features/chat/lib/user_message_rewrite";
import { create_chat_composer_from_user_parts } from "@/features/chat/composer/editor/chatSessionMessageCodec";
import { ChatSurfaceLayout } from "@/features/chat/components/ChatLayout";
import { cn } from "@/lib/utils";
import { translate, use_translation } from "@/locales/i18n";
import { is_chat_busy, type ChatHistoryState } from "@/types/DesktopView";
import type { SessionMessageProjection, SessionMessageSegment } from "@/types/SessionProjection";
import type { DesktopAgentSummary, DesktopChatRewriteAction, DesktopChatRewriteInput, DesktopChatRuntime, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

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
  /** 当前 Session 关联的 Workspace 已从 Registry 移除；仍可查看历史，发送前需重新绑定。 */
  workspace_missing?: boolean;
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
  /** 当前 Session 最新实时文件改动摘要。 */
  file_diff_by_session?: SessionTurnFileDiffSummary;
  /** 在主视图的 Workspace 中打开指定相对路径文件。 */
  open_workspace_file?(workspace_id: string, relative_path: string): void;
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
  /** 将空会话预设写入当前输入器。 */
  select_prompt(prompt: string): void;
  /** 当前场景自己的输入区域。 */
  composer: ReactNode;
  /** 响应当前审批或问题。 */
  respond_interaction?(input: RespondSessionInteractionInput): Promise<void>;
  /** 从指定消息创建并打开分支 Session。 */
  fork_message?(message_id: string): Promise<void>;
  /** 重写指定历史用户消息。 */
  rewrite_message?(input: DesktopChatRewriteInput): Promise<void>;
  /** 当前 Session 没有待发送队列，可以执行替换事务。 */
  can_replace_session?: boolean;
  /** 读取一个更早历史 Segment。 */
  load_earlier_history?(): Promise<void>;
}

/** 草稿没有历史消息能力；仅作为消息渲染器的内部空实现。 */
async function ignore_unavailable_history_action(): Promise<void> {}

/** Session 对话主视图。 */
export function SessionView(props: SessionViewProps) {
  const translate_chat = use_translation("chat");
  const { session, messages, runtime, settings } = props;
  const scroll_surface_id = get_session_key(props.workspace_id, props.agent.agent_id, session.session_id);
  const { scroll_ref, content_ref, bottom_ref, handle_scroll, preserve_prepend_position } = use_chat_scroll(scroll_surface_id, settings.auto_scroll);
  const busy = is_chat_busy(runtime);
  const message_projection_ref = useRef<SessionMessageProjection | undefined>(undefined);
  const projection_session_id_ref = useRef(session.session_id);
  const message_projection = useMemo(() => {
    const previous = projection_session_id_ref.current === session.session_id ? message_projection_ref.current : undefined;
    const next = project_session_message_segments(messages, previous);
    projection_session_id_ref.current = session.session_id;
    message_projection_ref.current = next;
    return next;
  }, [messages, session.session_id]);
  const open_workspace_file = useCallback((relative_path: string) => props.open_workspace_file?.(props.workspace_id, relative_path), [props.open_workspace_file, props.workspace_id]);

  const load_earlier = () => props.load_earlier_history
    ? preserve_prepend_position(props.load_earlier_history)
    : Promise.resolve();

  const workspace_tag = props.workspace_missing
    ? <span className="inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 text-[0.625rem] font-normal text-amber-600 dark:text-amber-400"><TbAlertTriangle className="size-3 shrink-0" /><span className="truncate">{translate_chat("message.workspace_missing")}</span></span>
    : props.workspace_draft_mode ? <ChatWorkspaceSelector workspace_id={props.workspace_id} workspaces={props.workspaces} disabled={busy} switch_workspace={props.switch_workspace} /> : <WorkspaceTagMenu workspace={props.workspace} />;
  return <ChatSurfaceLayout sidebar={props.session_sidebar} header_left={<div className="flex min-w-0 max-w-[min(100%,36rem)] items-center gap-2"><button type="button" disabled={!props.open_agent_info} onClick={props.open_agent_info} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-foreground transition-colors duration-150 enabled:hover:bg-interaction-hover" title={props.open_agent_info ? translate_chat("message.edit_agent") : undefined}><AgentAvatar agent={props.agent} class_name="size-5 rounded-md" /><span className="truncate">{session.title || translate_chat("conversation.new")}</span></button>{workspace_tag}</div>} header_right={<div className="flex shrink-0 items-center gap-1">
      {props.rename_session && props.archive_session && props.remove_session ? <SessionActionsMenu session={session} on_rename={props.rename_session} on_archive={props.archive_session} on_remove={props.remove_session} trigger={<button type="button" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title={translate_chat("conversation.actions")} aria-label={translate_chat("conversation.actions")}><TbDots className="size-4" /></button>} /> : null}
      </div>}
    >
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        <div
          ref={scroll_ref}
          className="chat-scroll-viewport relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          role="log"
          onScroll={handle_scroll}
        >
          <ChatTextSelectionQuote container_ref={scroll_ref} session_id={session.session_id} />
          <div ref={content_ref} className="chat-scroll-content mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {props.history?.has_more && props.load_earlier_history ? <div className="flex justify-center py-1"><Button disabled={props.history.loading} onClick={() => void load_earlier()}><TbArrowUp />{translate_chat(props.history.loading ? "message.loading_earlier" : "message.load_earlier")}</Button></div> : null}
            {messages.length === 0 ? <EmptyPrompts surface={props.chat_surface} agent={props.agent} workspace={props.workspace} workspaces={props.workspaces} agents={props.agents} switch_context={props.switch_draft_context} on_select={props.select_prompt} /> : null}
            <TurnFileOpenProvider open_file={props.open_workspace_file ? open_workspace_file : undefined} workspace_path={props.workspace.workspace_path || undefined}><ProgressiveMessageSegments key={session.session_id} segments={message_projection.segments}>{(segment) => <MessageSegment key={segment.segment_id} segment={segment} agent={props.agent} open_agent_info={props.open_agent_info} show_reasoning={settings.show_reasoning} respond_interaction={props.respond_interaction ?? ignore_unavailable_history_action} fork_message={props.fork_message ?? ignore_unavailable_history_action} rewrite_message={props.rewrite_message} file_diff={segment.has_streaming_message ? props.file_diff_by_session : undefined} can_use_history_actions={!busy} can_replace_session={props.can_replace_session ?? true} send_message_on_enter={settings.send_message_on_enter} />}</ProgressiveMessageSegments></TurnFileOpenProvider>
            {busy && !message_projection.has_streaming_message ? <ActivityIndicator agent={props.agent} status={runtime?.status} file_diff={props.file_diff_by_session} /> : null}
          </div>
          <div ref={bottom_ref} className="chat-scroll-bottom-anchor" aria-hidden="true" />
        </div>

        <div className="flex w-full flex-none flex-col">{props.composer}</div>
      </div>
  </ChatSurfaceLayout>;
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
const MessageRenderer = memo(function MessageRenderer({ message, agent, open_agent_info, show_reasoning, respond_interaction, fork_message, rewrite_message, file_diff, has_later_visible_message, can_use_history_actions, can_replace_session, send_message_on_enter }: { /** canonical 消息。 */ message: SessionMessage; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前 Session 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; /** 当前消息之后是否仍有可见内容。 */ has_later_visible_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean; /** Enter 是否直接提交编辑。 */ send_message_on_enter: boolean }) {
  if (message.role === "user" && Array.isArray(message.parts)) return <UserMessage message={message} fork_message={fork_message} rewrite_message={rewrite_message} has_later_visible_message={has_later_visible_message} can_use_history_actions={can_use_history_actions} can_replace_session={can_replace_session} send_message_on_enter={send_message_on_enter} />;
  if (message.role === "agent" && Array.isArray(message.parts)) return <AssistantMessage message={message} agent={agent} open_agent_info={open_agent_info} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} file_diff={file_diff} />;
  return null;
}, (previous, next) => previous.message === next.message
  && previous.agent === next.agent
  && previous.open_agent_info === next.open_agent_info
  && previous.show_reasoning === next.show_reasoning
  && previous.respond_interaction === next.respond_interaction
  && previous.fork_message === next.fork_message
  && previous.rewrite_message === next.rewrite_message
  && previous.file_diff === next.file_diff
  && previous.has_later_visible_message === next.has_later_visible_message
  && previous.can_use_history_actions === next.can_use_history_actions
  && previous.can_replace_session === next.can_replace_session
  && previous.send_message_on_enter === next.send_message_on_enter);

/**
 * 切换 Session 时先挂载最新分段，再逐帧向前补齐历史分段。
 * 这样 Markdown 与消息组件不会在一次点击帧内全部挂载，Sidebar 状态动画可以持续绘制。
 */
function ProgressiveMessageSegments({ segments, children }: { /** 按时间排序的消息分段。 */ segments: readonly SessionMessageSegment[]; /** 渲染一个已进入视图树的分段。 */ children(segment: SessionMessageSegment): ReactNode }) {
  const [first_visible_segment_id, set_first_visible_segment_id] = useState<number>();
  const stored_start_index = first_visible_segment_id === undefined
    ? -1
    : segments.findIndex((segment) => segment.segment_id === first_visible_segment_id);
  const start_index = stored_start_index >= 0 ? stored_start_index : Math.max(0, segments.length - 1);
  const next_segment_id = start_index > 0 ? segments[start_index - 1]?.segment_id : undefined;

  useEffect(() => {
    if (next_segment_id === undefined) return;
    const timer = window.setTimeout(() => set_first_visible_segment_id(next_segment_id), 24);
    return () => window.clearTimeout(timer);
  }, [next_segment_id]);

  return <>{segments.slice(start_index).map(children)}</>;
}

/** 只在分段内容或消息交互依赖变化时进入该分段的消息级协调。 */
const MessageSegment = memo(function MessageSegment({ segment, agent, open_agent_info, show_reasoning, respond_interaction, fork_message, rewrite_message, file_diff, can_use_history_actions, can_replace_session, send_message_on_enter }: { /** 稳定的消息渲染分段。 */ segment: SessionMessageSegment; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前流式消息的文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean; /** Enter 是否直接提交编辑。 */ send_message_on_enter: boolean }) {
  return <>{segment.rows.map(({ message, has_later_visible_message }) => <ChatMessageViewportRow key={message.message_id} row_id={message.message_id} active={message.role === "agent" && message.state === "streaming"}><MessageRenderer message={message} agent={agent} open_agent_info={open_agent_info} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} rewrite_message={rewrite_message} file_diff={message.role === "agent" && message.state === "streaming" ? file_diff : undefined} has_later_visible_message={has_later_visible_message} can_use_history_actions={can_use_history_actions} can_replace_session={can_replace_session} send_message_on_enter={send_message_on_enter} /></ChatMessageViewportRow>)}</>;
}, (previous, next) => previous.segment === next.segment
  && previous.agent === next.agent
  && previous.open_agent_info === next.open_agent_info
  && previous.show_reasoning === next.show_reasoning
  && previous.respond_interaction === next.respond_interaction
  && previous.fork_message === next.fork_message
  && previous.rewrite_message === next.rewrite_message
  && previous.can_use_history_actions === next.can_use_history_actions
  && previous.can_replace_session === next.can_replace_session
  && previous.send_message_on_enter === next.send_message_on_enter
  && (!next.segment.has_streaming_message || previous.file_diff === next.file_diff));

/** 用户消息及其引用、分支操作。 */
function UserMessage({ message, fork_message, rewrite_message, has_later_visible_message, can_use_history_actions, can_replace_session, send_message_on_enter }: { /** canonical 用户消息。 */ message: Extract<SessionMessage, { role: "user" }>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前消息之后是否仍有可见内容。 */ has_later_visible_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean; /** Enter 是否直接提交编辑。 */ send_message_on_enter: boolean }) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const initial_document = useMemo(() => create_chat_composer_from_user_parts(message.parts), [message.parts]);
  const [forking, set_forking] = useState(false);
  const [editing, set_editing] = useState(false);
  const [pending_document, set_pending_document] = useState<JSONContent | null>(null);
  const [submitting, set_submitting] = useState(false);
  const [rewrite_error, set_rewrite_error] = useState("");
  const [choice_open, set_choice_open] = useState(false);
  const fork = async () => {
    if (forking || !can_use_history_actions) return;
    set_forking(true);
    try { await fork_message(message.message_id); } finally { set_forking(false); }
  };
  const start_editing = () => {
    set_pending_document(null);
    set_rewrite_error("");
    set_editing(true);
  };
  const cancel_editing = () => {
    set_pending_document(null);
    set_rewrite_error("");
    set_editing(false);
  };
  const submit_rewrite = async (action: DesktopChatRewriteAction, document = pending_document) => {
    if (!document || !rewrite_message || submitting) return;
    if (action === "replace" && !can_replace_session) {
      set_rewrite_error(translate_chat("message.replace_blocked_queue"));
      return;
    }
    set_choice_open(false);
    set_rewrite_error("");
    set_submitting(true);
    try {
      await rewrite_message({ message_id: message.message_id, document, action });
      set_editing(false);
    } catch (reason) {
      set_rewrite_error(reason instanceof Error ? reason.message : translate_chat("message.send_failed"));
    } finally {
      set_submitting(false);
    }
  };
  const confirm_editing = (document: JSONContent) => {
    set_pending_document(document);
    set_rewrite_error("");
    if (resolve_user_message_rewrite(has_later_visible_message, can_replace_session) === "replace") void submit_rewrite("replace", document);
    else set_choice_open(true);
  };
  return <div className="group is-user flex w-full items-end justify-end gap-2 py-2">
    <div className="w-full flex justify-end">
      <div className={cn("user-message-stack flex w-full min-w-0 flex-col items-end gap-0.5", editing ? "max-w-[42rem]" : "max-w-[min(80%,42rem)]")}>
        <div className={cn("ml-auto flex max-w-full flex-col gap-2 overflow-hidden rounded-2xl rounded-tr-none bg-muted-foreground/10 text-sm text-foreground", editing ? "w-full p-2" : "w-fit px-3 py-2")}>
          {editing ? <UserMessageRewriteEditor initial_document={initial_document} submitting={submitting} error={rewrite_error} send_message_on_enter={send_message_on_enter} cancel={cancel_editing} submit={confirm_editing} /> : <>
          <UserMessageContent message_id={message.message_id} parts={message.parts} />
          </>}
        </div>
        {!editing ? <div className="flex h-5 items-center gap-1"><ChatMessageTimestamp created_at={message.created_at} class_name="mr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /><span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {message.parts.length > 0 && rewrite_message ? <MessageActionButton title={translate_chat("message.edit")} disabled={!can_use_history_actions} on_click={start_editing}><TbPencil /></MessageActionButton> : null}
          <MessageActionButton title={translate_chat("message.fork")} disabled={forking || !can_use_history_actions} on_click={() => void fork()}>{forking ? <TbLoader2 className="animate-spin" /> : <TbGitBranch />}</MessageActionButton>
          </span>
        </div> : null}
      </div>
    </div>
    <Dialog open={choice_open} onOpenChange={set_choice_open}>
      <DialogContent size="sm">
        <DialogHeader><div><DialogTitle>{translate_chat("message.rewrite_title")}</DialogTitle><DialogDescription>{translate_chat("message.rewrite_description")}</DialogDescription></div></DialogHeader>
        <DialogBody className="gap-2">
          <button type="button" disabled={submitting} onClick={() => void submit_rewrite("fork")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left hover:bg-foreground/[0.04]"><TbGitBranch className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">{translate_chat("message.fork_title")}</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">{translate_chat("message.fork_description")}</span></span></button>
          <button type="button" disabled={submitting || !can_replace_session} onClick={() => void submit_rewrite("replace")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left enabled:hover:bg-foreground/[0.04] disabled:opacity-50"><TbRoute className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">{translate_chat("message.replace_title")}</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">{translate_chat(can_replace_session ? "message.replace_description" : "message.replace_blocked_queue")}</span></span></button>
        </DialogBody>
        <DialogFooter><Button disabled={submitting} onClick={() => set_choice_open(false)}>{translate_common("actions.cancel")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

/** Assistant 消息按 Duobox 规则展示内容、活动流和尾部操作栏。 */
function AssistantMessage({ message, agent, open_agent_info, show_reasoning, respond_interaction, fork_message, file_diff }: { /** canonical Agent 消息。 */ message: Extract<SessionMessage, { role: "agent" }>; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info?(): void; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 当前 Session 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary; }) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
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
    <button type="button" disabled={!open_agent_info} onClick={open_agent_info} className="sticky top-2 z-10 shrink-0 rounded-md px-1 pt-0.5 transition-opacity duration-150 enabled:hover:opacity-75" title={open_agent_info ? translate_chat("message.edit_agent") : undefined} aria-label={open_agent_info ? translate_chat("message.edit_agent_name", { name: agent.name }) : undefined}>
      <AgentAvatar agent={agent} class_name="size-7 rounded-md" />
    </button>
    <div className="flex min-w-0 flex-1 flex-col gap-0 overflow-visible rounded-none pb-0 pt-0.5 text-sm text-foreground">
      <div className="mb-1 flex min-w-0 items-center gap-2"><button type="button" disabled={!open_agent_info} onClick={open_agent_info} className="min-w-0 truncate text-xs font-medium text-foreground/85 transition-colors duration-150 enabled:hover:text-foreground enabled:hover:underline">{agent.name}</button><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></div>
      <div className="min-h-0 w-full">
        <AssistantContent message_id={message.message_id} parts={message.parts} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.state === "streaming"} />
      </div>
      {message.state === "streaming" ? <ActivityIndicator status="streaming" compact file_diff={file_diff} /> : show_actions ? <div className="assistant-message-menu-bar flex h-6 min-h-6 shrink-0 items-center">
        {text ? <div className="message-action-toolbar pointer-events-none flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <MessageActionButton title={translate_chat("message.copy")} on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title={translate_common("actions.more")} aria-label={translate_common("actions.more")}><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "agent", text })}><TbMessageReply className="size-3.5" /><span>{translate_chat("message.quote")}</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{translate_chat(forking ? "message.forking" : "message.fork")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div> : null}
      </div> : null}
    </div>
  </div>;
}

const message_action_button_class_name = "group/message-action flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]";

/** 消息下方的紧凑图标操作按钮。 */
function MessageActionButton({ title, disabled, on_click, children }: { /** 操作提示。 */ title: string; /** 是否禁用。 */ disabled?: boolean; /** 执行动作。 */ on_click(): void; /** 操作图标。 */ children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={on_click} className={message_action_button_class_name} title={title} aria-label={title}>{children}</button>;
}

/** 新建 Chat 输入框上方的当前上下文。 */
function NewChatContextSelector({ workspace, workspaces, agent, agents, switch_context }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 提交上下文切换。 */ switch_context(workspace_id: string, agent_id: string): void }) {
  const translate_chat = use_translation("chat");
  return <div className="flex min-w-0 max-w-full flex-col items-center gap-4">
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="group flex min-w-0 max-w-full flex-col items-center gap-2 rounded-xl px-5 py-3 transition-colors hover:bg-foreground/[0.05]" aria-label={translate_chat("conversation.select_contact")}><AgentAvatar agent={agent} class_name="size-14 rounded-2xl" /><span className="flex max-w-64 items-center gap-1.5 text-base font-medium text-foreground"><span className="truncate">{agent.name}</span><TbChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></span><span className="text-xs text-muted-foreground">{translate_chat("conversation.contact")}</span></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{agents.map((item) => <DropdownMenuItem key={item.agent_id} is_selected={item.agent_id === agent.agent_id} onClick={() => switch_context(workspace.workspace_id, item.agent_id)}><AgentAvatar agent={item} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.agent_id === agent.agent_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-w-0 max-w-72 items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground" aria-label={translate_chat("conversation.select_workspace")}><TbFolder className="size-4 shrink-0" /><span className="truncate">{workspace.name}</span><TbChevronDown className="size-3.5 shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="center" side="bottom" sideOffset={6}>{workspaces.map((item) => <DropdownMenuItem key={item.workspace_id} is_selected={item.workspace_id === workspace.workspace_id} onClick={() => switch_context(item.workspace_id, agent.agent_id)}><TbFolder className="size-4" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.workspace_id === workspace.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <span className="text-[0.6875rem] text-muted-foreground/70">{translate_chat("message.choose_context")}</span>
  </div>;
}

/** 运行活动提示。 */
function ActivityIndicator({ agent, status, compact = false, file_diff }: { /** 当前 Agent；非 compact 状态下用于显示身份。 */ agent?: DesktopAgentSummary; /** 运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入消息。 */ compact?: boolean; /** 当前 Session 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary }) {
  const translate_chat = use_translation("chat");
  const status_content = <span className="activity-tool-main h-5"><span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span><span className="thinking-status-label">{translate_chat(status === "submitted" ? "message.submitting" : status === "waiting_input" ? "message.waiting_input" : "activity.thinking")}</span>{status === "streaming" && file_diff && file_diff.files_count > 0 ? <span className="thinking-file-diff"><span className="thinking-status-label">{translate_chat("message.files_changed", { count: file_diff.files_count })}</span><span className="thinking-file-diff-stats"><span className="text-emerald-600 dark:text-emerald-400">+{file_diff.additions}</span><span className="text-red-500 dark:text-red-400">-{file_diff.deletions}</span></span></span> : null}</span>;
  if (compact || !agent) return <div className="assistant-message-menu-bar flex h-6 min-h-6 items-center pl-1">{status_content}</div>;
  return <div className="group is-assistant flex w-full items-start gap-2 py-2 !m-0 !p-0">
    <div className="shrink-0 px-1 pt-0.5"><AgentAvatar agent={agent} class_name="size-7 rounded-md" /></div>
    <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-visible pt-0.5 text-sm text-foreground">
      <div className="min-w-0 truncate text-xs font-medium text-foreground/85">{agent.name}</div>
      <div className="assistant-message-menu-bar flex items-center">{status_content}</div>
    </div>
  </div>;
}
