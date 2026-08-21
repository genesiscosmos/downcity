/** Downcity Session Chat 主视图，交互语义与 Duobox ChatCore 保持一致。 */

import { useEffect, useRef, useState } from "react";
import type { RespondSessionInteractionInput, SessionMessage } from "@downcity/agent";
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
  TbWriting,
} from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AssistantContent } from "@/lib/chat/assistant/AssistantActivity";
import { should_show_assistant_actions } from "@/lib/chat/assistant/assistant_activity";
import { ChatMarkdown } from "@/lib/chat/ChatMarkdown";
import { ChatInputEditor } from "@/lib/chat/ChatInputEditor";
import { dispatch_chat_reference } from "@/lib/chat/editor/chatReferenceEvent";
import { resolve_user_message_rewrite } from "@/lib/chat/user_message_rewrite";
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { cn } from "@/lib/utils";
import { is_chat_busy, type ChatHistoryState, type QueuedChatMessage } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopChatInput, DesktopChatReferenceInput, DesktopChatRewriteAction, DesktopChatRewriteInput, DesktopChatRuntime, DesktopModelSummary, DesktopSessionConfiguration, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";

/** Session Chat 主视图属性。 */
interface SessionViewProps {
  /** Session 所属 Agent。 */
  agent: DesktopAgentSummary;
  /** Session 所属 Workspace。 */
  workspace: DesktopWorkspaceSummary;
  /** 可切换的全部 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 可切换的全部 Agent。 */
  agents: DesktopAgentSummary[];
  /** 当前 Session 摘要。 */
  session: DesktopSessionSummary;
  /** 当前 Session 的 canonical 可见消息。 */
  messages: SessionMessage[];
  /** 当前 Session 实时运行态。 */
  runtime?: DesktopChatRuntime;
  /** 当前 Session 输入草稿。 */
  draft: string;
  /** 当前 Session 附件草稿。 */
  draft_files: DesktopChatFileInput[];
  /** 当前 Session 消息引用草稿。 */
  draft_references: DesktopChatReferenceInput[];
  /** 当前 Session 待发送队列。 */
  queued_messages: QueuedChatMessage[];
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
  /** 更新当前输入草稿。 */
  update_draft(text: string): void;
  /** 更新当前附件草稿。 */
  update_draft_files(files: DesktopChatFileInput[]): void;
  /** 更新当前消息引用草稿。 */
  update_draft_references(references: DesktopChatReferenceInput[]): void;
  /** 发送或排队一条消息。 */
  send_message(input: DesktopChatInput): Promise<void>;
  /** 请求压缩当前 Session 历史上下文。 */
  compact_session?(): Promise<void>;
  /** 刷新模型目录。 */
  refresh_models(): Promise<void>;
  /** 切换当前模型。 */
  set_model(model_id: string): Promise<void>;
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

  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2">
      <div className="min-w-0 flex-1 truncate pl-1 text-xs font-medium text-foreground">{session.title || "新对话"}</div>
      {props.rename_session && props.archive_session && props.remove_session ? <SessionActionsMenu session={session} on_rename={props.rename_session} on_archive={props.archive_session} on_remove={props.remove_session} trigger={<button type="button" className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" title="对话操作" aria-label="对话操作"><TbDots className="size-4" /></button>} /> : null}
    </header>
    <MainViewBody>
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
          <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[840px] flex-col p-2">
            {props.history?.has_more ? <div className="flex justify-center py-1"><Button disabled={props.history.loading} onClick={() => void load_earlier()}><TbArrowUp />{props.history.loading ? "正在加载…" : "加载更早消息"}</Button></div> : null}
            {messages.length === 0 ? <EmptyPrompts on_select={props.update_draft} /> : null}
            {messages.map((message, index) => <MessageRenderer key={message.message_id} message={message} agent={props.agent} show_reasoning={settings.show_reasoning} respond_interaction={props.respond_interaction} fork_message={props.fork_message} rewrite_message={props.rewrite_message} is_last_message={index === messages.length - 1} can_use_history_actions={!busy} />)}
            {busy && !has_streaming_assistant(messages) ? <ActivityIndicator status={runtime?.status} /> : null}
          </div>
        </div>

        <div className="mx-auto m-2 flex w-[calc(100%-1rem)] max-w-[840px] flex-none flex-col gap-2">
          {session.session_id.startsWith("draft:") ? <ChatContextBar workspace={props.workspace} workspaces={props.workspaces} agent={props.agent} agents={props.agents} switch_context={props.switch_draft_context} /> : null}
          <div className="rounded-2xl bg-muted-foreground/10">
            <ChatInputEditor
              editor_key={session.session_id}
              agent={props.agent}
              draft={props.draft}
              draft_files={props.draft_files}
              draft_references={props.draft_references}
              runtime={props.runtime}
              queued_messages={props.queued_messages}
              configuration={props.configuration}
              models={props.models}
              models_loading={props.models_loading}
              settings={props.settings}
              update_draft={props.update_draft}
              update_draft_files={props.update_draft_files}
              update_draft_references={props.update_draft_references}
              send_message={props.send_message}
              compact_session={can_compact ? props.compact_session : undefined}
              stop_session={props.stop_session}
              refresh_models={props.refresh_models}
              set_model={props.set_model}
              set_approval_mode={props.set_approval_mode}
              remove_queued_message={props.remove_queued_message}
              move_queued_message={props.move_queued_message}
            />
          </div>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** 空会话提示。 */
function EmptyPrompts({ on_select }: { /** 将预设提示放入输入框。 */ on_select(prompt: string): void }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 px-4">
    <p className="text-center text-sm text-muted-foreground">开始新的对话</p>
    <div className="flex w-full max-w-80 flex-col gap-1">
      {empty_prompts.map(({ title, description, icon: Icon, prompt }) => <Button key={title} size="full" className="h-auto min-h-12 items-start gap-2 rounded-md px-2.5 py-2 text-left whitespace-normal text-foreground/75" onClick={() => on_select(prompt)}>
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1"><span className="block text-[0.6875rem] font-medium leading-4">{title}</span><span className="mt-0.5 block text-[0.625rem] leading-3.5 text-muted-foreground">{description}</span></span>
      </Button>)}
    </div>
  </div>;
}

/** 按 canonical 消息类型渲染。 */
function MessageRenderer({ message, agent, show_reasoning, respond_interaction, fork_message, rewrite_message, is_last_message, can_use_history_actions }: { /** canonical 消息。 */ message: SessionMessage; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 是否是当前消息列表最后一条。 */ is_last_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean }) {
  if (message.type === "error") return <div className="group is-assistant flex min-w-0 w-full items-start gap-2 py-2 !m-0 !p-0">
    <div className="size-8 shrink-0 px-1" aria-hidden="true" />
    <div className="min-w-0 flex-1 px-1 pt-0.5 text-sm text-foreground">
      <div className="flex min-w-0 w-full items-start gap-2 rounded-md bg-foreground/[0.045] px-2.5 py-2">
        <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.78125rem] leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{message.message}</p>
      </div>
    </div>
  </div>;
  if (message.type === "action") return <div className="group is-assistant flex w-full flex-row-reverse items-end justify-end gap-2 !m-0 !p-0">
    <div className="flex w-full flex-col gap-0 px-1 pt-0.5 pb-0 !overflow-visible !rounded-none text-sm text-foreground">
      <div className="flex min-h-0 w-full items-center gap-3">
        <span className="h-px min-w-4 flex-1 bg-border/60" aria-hidden />
        <div className="min-w-0 max-w-[80%] text-center text-[0.8125rem] leading-[1.54] text-foreground/90">
          <span>{message.title}</span>{message.description ? <span className="ml-1.5 text-muted-foreground">{message.description}</span> : null}
        </div>
        <span className="h-px min-w-4 flex-1 bg-border/60" aria-hidden />
      </div>
    </div>
  </div>;
  if (message.type === "user") return <UserMessage message={message} fork_message={fork_message} rewrite_message={rewrite_message} is_last_message={is_last_message} can_use_history_actions={can_use_history_actions} />;
  return <AssistantMessage message={message} agent={agent} show_reasoning={show_reasoning} respond_interaction={respond_interaction} fork_message={fork_message} />;
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
          {text ? <div className="text-[0.8125rem] leading-[1.34]"><ChatMarkdown class_name="user-message-markdown !h-auto !w-auto break-words" text={text} mode="static" /></div> : null}
          {message.parts.flatMap((part) => part.type === "file" ? [<a key={part.part_id} href={part.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-[0.75rem] text-foreground/80"><TbFile className="size-3.5 shrink-0" /><span className="truncate">{part.filename || "文件"}</span></a>] : [])}
          </>}
        </div>
        {!editing ? <div className="flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {text && rewrite_message ? <MessageActionButton title="编辑" disabled={!can_use_history_actions} on_click={start_editing}><TbPencil /></MessageActionButton> : null}
          <MessageActionButton title="创建分支" disabled={forking || !can_use_history_actions} on_click={() => void fork()}>{forking ? <TbLoader2 className="animate-spin" /> : <TbGitBranch />}</MessageActionButton>
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
function AssistantMessage({ message, agent, show_reasoning, respond_interaction, fork_message }: { /** canonical Assistant 消息。 */ message: Extract<SessionMessage, { type: "assistant" }>; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void> }) {
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
    <div className="sticky top-2 z-10 shrink-0 px-1 pt-0.5">
      <AgentAvatar agent={agent} class_name="size-7 rounded-md" />
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-0 overflow-visible rounded-none pb-0 pt-0.5 text-sm text-foreground">
      <div className="mb-1 min-w-0 truncate text-xs font-medium text-foreground/85">{agent.agent_id}</div>
      <div className="min-h-0 w-full">
        <AssistantContent parts={message.parts} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.status === "streaming"} />
      </div>
      {message.status === "streaming" ? <ActivityIndicator status="streaming" compact /> : show_actions ? <div className="assistant-message-menu-bar flex h-6 min-h-6 shrink-0 items-center">
        {text ? <div className="message-action-toolbar pointer-events-none flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <MessageActionButton title="复制" on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title="更多操作" aria-label="更多操作"><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "assistant", text })}><TbMessageReply className="size-3.5" /><span>引用到输入框</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{forking ? "正在创建分支" : "创建分支"}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
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
function ChatContextBar({ workspace, workspaces, agent, agents, switch_context }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** 可切换 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 可切换 Agent。 */ agents: DesktopAgentSummary[]; /** 提交上下文切换。 */ switch_context(workspace_id: string, agent_id: string): void }) {
  return <div className="flex min-w-0 items-center gap-1 self-start rounded-lg border border-border/35 bg-muted-foreground/[0.07] p-1 text-[0.6875rem] text-muted-foreground">
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-foreground/[0.06] hover:text-foreground" aria-label="切换 Workspace"><TbFolder className="size-3.5 shrink-0" /><span className="max-w-48 truncate">{workspace.name}</span><TbChevronDown className="size-3 shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={6}>{workspaces.map((item) => <DropdownMenuItem key={item.workspace_id} is_selected={item.workspace_id === workspace.workspace_id} onClick={() => switch_context(item.workspace_id, agent.agent_id)}><TbFolder className="size-3.5" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.workspace_id === workspace.workspace_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <span className="h-4 w-px bg-border/60" aria-hidden />
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-foreground/[0.06] hover:text-foreground" aria-label="切换 Agent"><AgentAvatar agent={agent} class_name="size-5 rounded" /><span className="max-w-48 truncate">{agent.agent_id}</span><TbChevronDown className="size-3 shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={6}>{agents.map((item) => <DropdownMenuItem key={item.agent_id} is_selected={item.agent_id === agent.agent_id} onClick={() => switch_context(workspace.workspace_id, item.agent_id)}><AgentAvatar agent={item} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">{item.agent_id}</span>{item.agent_id === agent.agent_id ? <TbCheck className="size-3.5 text-primary" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  </div>;
}

/** 运行活动提示。 */
function ActivityIndicator({ status, compact = false }: { /** 运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入消息。 */ compact?: boolean }) {
  return <div className={cn("assistant-message-menu-bar flex items-center pl-1", compact ? "h-6 min-h-6" : "px-1 py-2")}><span className="activity-tool-main h-5"><span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span><span className="thinking-status-label">{status === "submitted" ? "正在提交" : status === "waiting_input" ? "等待输入" : "正在思考"}</span></span></div>;
}

/** 判断当前已有 streaming assistant。 */
function has_streaming_assistant(messages: SessionMessage[]): boolean {
  return messages.some((message) => message.type === "assistant" && message.status === "streaming");
}
