/**
 * Duobox Chat Panel 的通用受控实现。
 *
 * 组件复刻消息、活动、历史和输入区的 DOM 层级；Session、审批响应、文件读取、
 * 模型选择和草稿持久化由宿主通过回调拥有。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, History, LoaderCircle, MessageCircle, Paperclip, Plus, X } from "lucide-react";
import { cn } from "../lib/utils";
import { AgentChatMessage, UserMessage } from "./chat-messages";
import { ChatInput } from "./chat-input/ChatInput";
import { create_chat_composer, read_chat_composer_text } from "./chat-input/chatComposerCodec";
import { project_chat_composer } from "../lib/chat-document-projection";
import type { DowncityChatApprovalMode, DowncityChatMessage, DowncityChatPanelProps, DowncityChatThread } from "../types/chat";
import type { DowncityChatQueuedInput } from "../types/chat-runtime";

function format_thread_time(value: DowncityChatThread["updated_at"]): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** 聊天消息统一使用 SDK 的 AgentChatMessage 与 UserMessage。 */
export function ChatMessage({ message, render_message, on_respond_interaction, render_interaction, on_retry_message, retry_message_id }: Pick<DowncityChatPanelProps, "render_message" | "on_respond_interaction" | "render_interaction" | "on_retry_message" | "retry_message_id"> & { message: DowncityChatMessage }) {
  if (message.role === "system") return null;
  const content = render_message?.({ message });
  return message.role === "user" ? <UserMessage message={message}>{content}</UserMessage> : <AgentChatMessage message={message} retry_message={retry_message_id === message.id ? on_retry_message : undefined} can_retry={retry_message_id === message.id} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction}>{content}</AgentChatMessage>;
}

/** 直接组合消息列表；宿主可在自己的 Chat 页面中使用，不需要 ChatPanel 封装。 */
export function ChatMessageList({ messages, render_message, on_respond_interaction, render_interaction }: { messages: DowncityChatMessage[]; render_message?: DowncityChatPanelProps["render_message"]; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"]; render_interaction?: DowncityChatPanelProps["render_interaction"] }) {
  return <div className="dc-chat-conversation-content">{messages.filter((message) => message.role !== "system").map((message) => <ChatMessage key={message.id} message={message} render_message={render_message} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction} />)}</div>;
}

type ChatComposerProps = Pick<DowncityChatPanelProps, "status" | "input_placeholder" | "on_submit" | "on_stop" | "on_attach" | "model_options" | "model_id" | "on_model_change" | "approval_mode" | "on_approval_mode_change"> & {
  /** 输入所属的 Session，变更时重建独立草稿。 */ editor_key?: string;
  /** 当前由 Chat runtime 持有的等待队列。 */ queued_inputs?: DowncityChatQueuedInput[];
  /** 删除等待队列中的一项。 */ on_remove_queued?: (input_id: string) => void;
  /** 调整等待队列中一项的顺序。 */ on_move_queued?: (input_id: string, direction: "up" | "down") => void;
};

/** ChatPanel 的场景适配：输入事务与节点完全使用 ChatInput。 */
export function ChatComposer({ editor_key = "chat-panel", status = "ready", input_placeholder, on_submit, on_stop, on_attach, model_options = [], model_id, on_model_change, approval_mode = "ask", on_approval_mode_change, queued_inputs = [], on_remove_queued, on_move_queued }: ChatComposerProps) {
  const [draft, set_draft] = useState(() => create_chat_composer());
  const [submit_error, set_submit_error] = useState<string>();
  const busy = status === "streaming" || status === "submitted" || status === "building-context";
  return <div className="dc-chat-input-root">
    {queued_inputs.length ? <div className="dc-chat-queue">{queued_inputs.map((item, index) => <div key={item.id}><ArrowDown /><span>{item.text}</span><button type="button" title="Move up" disabled={index === 0} onClick={() => on_move_queued?.(item.id, "up")}><ArrowUp /></button><button type="button" title="Move down" disabled={index === queued_inputs.length - 1} onClick={() => on_move_queued?.(item.id, "down")}><ArrowDown /></button><button type="button" title="Remove" onClick={() => on_remove_queued?.(item.id)}><X /></button></div>)}</div> : null}
    <div className="dc-chat-input-shell"><ChatInput editor_key={editor_key} draft_content={draft} update_draft={set_draft} busy={busy} can_queue has_pending_queue={queued_inputs.length > 0} spellcheck_enabled={false} placeholder={input_placeholder ?? "Message…"} submit_disabled={!on_submit} stop_session={on_stop ? async () => { await on_stop(); } : undefined}
      send_message={async (document, mode = "send") => {
        set_submit_error(undefined);
        try { if (!on_submit) throw new Error("No Session connected"); await on_submit({ text: read_chat_composer_text(document), attachments: [], parts: project_chat_composer(document) }, mode); }
        catch (error) { set_submit_error(String(error)); throw error; }
      }}
      attachments={{ list_files: async () => [], read_file: async () => { throw new Error("Workspace files are not configured"); } }}
      toolbar={<>{on_attach ? <button type="button" onClick={on_attach} aria-label="Attach"><Paperclip className="size-4" /></button> : null}{on_model_change && model_options.length ? <select aria-label="Model" value={model_id} onChange={event => void on_model_change(event.target.value)}>{model_options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select> : null}{on_approval_mode_change ? <select aria-label="Approval mode" value={approval_mode} onChange={event => void on_approval_mode_change(event.target.value as DowncityChatApprovalMode)}><option value="ask">Ask</option><option value="always-allow">Allow</option></select> : null}</>}
    /></div>{submit_error ? <p role="alert" className="text-xs text-destructive">{submit_error}</p> : null}
  </div>;
}

/** Duobox 风格历史列表。 */
export function ChatHistory({ threads, current_thread_id, loading, has_more, on_select, on_archive, on_load_more }: { threads: DowncityChatThread[]; current_thread_id?: string; loading?: boolean; has_more?: boolean; on_select?: DowncityChatPanelProps["on_select_thread"]; on_archive?: DowncityChatPanelProps["on_archive_thread"]; on_load_more?: DowncityChatPanelProps["on_load_more_threads"] }) {
  return <aside className="dc-chat-history"><header><div><MessageCircle /><span>Chat</span></div><small>历史会话</small></header><div className="dc-chat-history-list">{threads.map((thread) => <div className={cn("dc-chat-thread", thread.id === current_thread_id && "is-active")} key={thread.id}><button onClick={() => void on_select?.(thread.id)}><span>{thread.title || "未命名会话"}</span><small>{format_thread_time(thread.updated_at)}</small></button>{thread.unread ? <i /> : null}{on_archive ? <button className="dc-chat-thread-menu" onClick={() => void on_archive(thread.id)}><Archive /></button> : null}</div>)}{loading ? <div className="dc-chat-history-state"><LoaderCircle className="animate-spin" />加载中…</div> : null}{has_more ? <button className="dc-chat-history-more" onClick={() => void on_load_more?.()}>加载更多</button> : null}</div></aside>;
}

/** 组合顶部栏、对话滚动区、消息和输入区的通用 Chat Panel。 */
export function ChatPanel({ className, runtime, thread, threads = [], messages: provided_messages = [], status: provided_status = "ready", history_open = false, history_loading, has_more_threads, title, empty_title = "开始一段新对话", empty_description = "输入消息，与 Agent 开始交流。", input_placeholder, model_options: provided_model_options, model_id: provided_model_id, on_model_change, approval_mode: provided_approval_mode, on_approval_mode_change, on_submit, on_stop, on_respond_interaction, render_interaction, on_attach, on_create_thread, on_select_thread, on_archive_thread, on_load_more_threads, render_message, render_header_actions, render_footer, on_retry_message, retry_message_id, ...props }: DowncityChatPanelProps) {
  const runtime_snapshot = useSyncExternalStore(useMemo(() => runtime ? (listener: () => void) => runtime.subscribe(listener) : () => () => {}, [runtime]), () => runtime?.get_snapshot() ?? null, () => runtime?.get_snapshot() ?? null);
  const messages = runtime_snapshot?.messages ?? provided_messages;
  const status = runtime_snapshot?.status ?? provided_status;
  const model_options = runtime_snapshot?.model_options ?? provided_model_options;
  const model_id = runtime_snapshot?.model_id ?? provided_model_id;
  const approval_mode = runtime_snapshot?.approval_mode ?? provided_approval_mode;
  const [show_history, set_show_history] = useState(history_open);
  const conversation_ref = useRef<HTMLDivElement>(null);
  const [is_at_bottom, set_is_at_bottom] = useState(true);
  useEffect(() => set_show_history(history_open), [history_open]);
  useEffect(() => { if (is_at_bottom) conversation_ref.current?.scrollTo({ top: conversation_ref.current.scrollHeight }); }, [messages, is_at_bottom]);
  const visible_messages = useMemo(() => messages.filter((message: DowncityChatMessage) => message.role !== "system"), [messages]);
  return <div className={cn("dc-chat-panel", className)} {...props}>
    <header className="dc-chat-header">{on_select_thread || threads.length ? <button type="button" onClick={() => set_show_history(value => !value)} title="历史会话">{show_history ? <ChevronLeft /> : <History />}</button> : null}<div className="dc-chat-header-title"><span>{title ?? thread?.title ?? "新对话"}</span>{thread?.updated_at ? <small>{format_thread_time(thread.updated_at)}</small> : null}</div><div className="dc-chat-header-drag" />{on_create_thread ? <button type="button" onClick={() => void on_create_thread()} title="新建会话"><Plus /></button> : null}{render_header_actions?.()}</header>
    {show_history ? <ChatHistory threads={threads} current_thread_id={thread?.id} loading={history_loading} has_more={has_more_threads} on_select={(thread_id) => { set_show_history(false); return on_select_thread?.(thread_id); }} on_archive={on_archive_thread} on_load_more={on_load_more_threads} /> : <div className="dc-chat-body">
      <div className="dc-chat-conversation" ref={conversation_ref} role="log" onScroll={(event) => { const target = event.currentTarget; set_is_at_bottom(target.scrollHeight - target.scrollTop - target.clientHeight < 24); }}><div className="dc-chat-conversation-content">{visible_messages.length ? visible_messages.map((message: DowncityChatMessage) => <ChatMessage key={message.id} message={message} retry_message_id={runtime_snapshot?.retry_message_id ?? retry_message_id} on_retry_message={runtime ? id => runtime.retry(id) : on_retry_message} render_message={render_message} on_respond_interaction={runtime ? (id, response) => runtime.respond_interaction(id, response) : on_respond_interaction} render_interaction={render_interaction} />) : <div className="dc-chat-empty"><MessageCircle /><h2>{empty_title}</h2><p>{empty_description}</p></div>}{runtime_snapshot?.error ? <p role="alert" className="text-xs text-destructive">{runtime_snapshot.error}</p> : null}{render_footer?.()}</div></div>
      {!is_at_bottom ? <button className="dc-chat-scroll-button" onClick={() => conversation_ref.current?.scrollTo({ top: conversation_ref.current.scrollHeight, behavior: "smooth" })}><ArrowDown /></button> : null}
      <ChatComposer key={runtime_snapshot?.session_id ?? thread?.id ?? "chat-panel"} editor_key={runtime_snapshot?.session_id ?? thread?.id ?? "chat-panel"} status={status} input_placeholder={input_placeholder} model_options={model_options} model_id={model_id} on_model_change={on_model_change ? async next_model_id => { await on_model_change(next_model_id); runtime?.set_model(next_model_id); } : undefined} approval_mode={approval_mode} on_approval_mode_change={on_approval_mode_change ? async next_mode => { await on_approval_mode_change(next_mode); runtime?.set_approval_mode(next_mode); } : undefined} on_submit={(input, mode = "send") => runtime ? runtime.submit(input, mode) : on_submit?.(input, mode)} on_stop={() => runtime ? runtime.stop() : on_stop?.()} on_attach={on_attach} queued_inputs={runtime_snapshot?.queued_inputs} on_remove_queued={(input_id) => runtime?.remove_queued_input(input_id)} on_move_queued={(input_id, direction) => runtime?.move_queued_input(input_id, direction)} />
    </div>}
  </div>;
}
