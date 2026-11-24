/**
 * Duobox Chat Panel 的通用受控实现。
 *
 * 组件复刻消息、活动、历史和输入区的 DOM 层级；Session、审批响应、文件读取、
 * 模型选择和草稿持久化由宿主通过回调拥有。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, History, LoaderCircle, MessageCircle, Paperclip, Plus, X } from "lucide-react";
import { cn } from "../lib/utils";
import { ControlMessagesProvider, default_control_translate } from "../lib/control-messages";
import { AgentChatMessage, UserMessage } from "./chat-messages";
import { ChatInput } from "./chat-input/ChatInput";
import { ActivityProvider } from "./agent-activity";
import { ChatComposerStatus, message_pending_interactions } from "./chat-status";
import type { ChatComposerStatusProps } from "./chat-status";
import type { JSONContent } from "@tiptap/core";
import { input_messages } from "./chat-input/messages";
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
export function ChatMessage({ message, agent, render_message, on_respond_interaction, render_interaction, on_retry_message, retry_message_id }: Pick<DowncityChatPanelProps, "agent" | "render_message" | "on_respond_interaction" | "render_interaction" | "on_retry_message" | "retry_message_id"> & { message: DowncityChatMessage }) {
  if (message.role === "system") return null;
  const content = render_message?.({ message });
  return message.role === "user" ? <UserMessage message={message}>{content}</UserMessage> : <AgentChatMessage message={message} agent={agent} retry_message={retry_message_id === message.id ? on_retry_message : undefined} can_retry={retry_message_id === message.id} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction}>{content}</AgentChatMessage>;
}

/** 直接组合消息列表；宿主可在自己的 Chat 页面中使用，不需要 ChatPanel 封装。 */
export function ChatMessageList({ messages, render_message, on_respond_interaction, render_interaction }: { messages: DowncityChatMessage[]; render_message?: DowncityChatPanelProps["render_message"]; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"]; render_interaction?: DowncityChatPanelProps["render_interaction"] }) {
  return <div className="dc-chat-conversation-content">{messages.filter((message) => message.role !== "system").map((message) => <ChatMessage key={message.id} message={message} render_message={render_message} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction} />)}</div>;
}

type ChatComposerProps = Pick<DowncityChatPanelProps, "translate" | "status" | "input_placeholder" | "on_submit" | "on_stop" | "on_attach" | "model_options" | "model_id" | "on_model_change" | "approval_mode" | "on_approval_mode_change"> & {
  /** 输入所属的 Session，变更时重建独立草稿。 */ editor_key?: string;
  /** 唯一状态面板与队列适配器；省略时输入区仍可独立挂载。 */
  composer_status?: Omit<ChatComposerStatusProps, "on_edit" | "session_key">;

};

/** ChatPanel 的场景适配：输入事务与节点完全使用 ChatInput。 */
export function ChatComposer({ translate, editor_key = "chat-panel", status = "ready", input_placeholder, on_submit, on_stop, on_attach, model_options = [], model_id, on_model_change, approval_mode = "ask", on_approval_mode_change, composer_status }: ChatComposerProps) {
  const [draft, set_draft] = useState(() => create_chat_composer());
  const [submit_error, set_submit_error] = useState<string>();
  const previous_draft = useRef<JSONContent | undefined>(undefined);
  const editing_id = composer_status?.snapshot?.editing_queue_id;
  const queued_inputs = composer_status?.snapshot?.queued_inputs ?? [];
  const label = (key: string) => (translate ?? default_control_translate)(`chat:${key}`);
  const busy = status === "streaming" || status === "submitted" || status === "building-context";
  return <div className="dc-chat-input-root">
    {composer_status ? <ChatComposerStatus {...composer_status} session_key={editor_key} on_edit={input => {
      previous_draft.current = draft;
      set_draft(input.document ?? create_chat_composer(input.text));
    }} /> : null}
    {editing_id ? <div className="dc-chat-queue-edit"><span>{label("queue.editing")}</span><button type="button" onClick={() => { composer_status?.runtime?.finish_queue_edit(); set_draft(previous_draft.current ?? create_chat_composer()); previous_draft.current = undefined; }}>{label("queue.cancel")}</button></div> : null}
    <div className="dc-chat-input-shell"><ChatInput key={`${editor_key}:${editing_id ?? "draft"}`} clear_on_submit={editing_id ? false : undefined} submit_label={editing_id ? label("queue.confirm_edit") : undefined} host={translate ? { translate: (key, values) => {
      const result = translate(`chat:${key}`, values);
      return result === `chat:${key}` ? (input_messages[key] ?? key).replace(/\{\{?(\w+)\}?\}/g, (match, name: string) => String(values?.[name] ?? match)) : result;
    } } : undefined} editor_key={`${editor_key}:${editing_id ?? "draft"}`} draft_content={draft} update_draft={set_draft} busy={editing_id ? false : busy} can_queue={!editing_id} has_pending_queue={queued_inputs.length > 0} spellcheck_enabled={false} placeholder={input_placeholder ?? "Message…"} submit_disabled={!on_submit} stop_session={on_stop ? async () => { await on_stop(); } : undefined}
      send_message={async (document, mode = "send") => {
        set_submit_error(undefined);
        try { if (!on_submit) throw new Error("No Session connected"); const input = { document, text: read_chat_composer_text(document), attachments: [], parts: project_chat_composer(document) };
          if (editing_id && composer_status?.runtime) {
            composer_status.runtime.finish_queue_edit(input);
            set_draft(previous_draft.current ?? create_chat_composer());
            previous_draft.current = undefined;
          } else await on_submit(input, mode); }
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
export function ChatPanel({ className, runtime, translate, agent, thread, threads = [], messages: provided_messages = [], status: provided_status = "ready", history_open = false, history_loading, has_more_threads, title, show_header = true, on_load_earlier, earlier_loading, earlier_label = "Earlier messages", earlier_loading_label = "Loading…", earlier_error, empty_title = "开始一段新对话", empty_description = "输入消息，与 Agent 开始交流。", input_placeholder, model_options: provided_model_options, model_id: provided_model_id, on_model_change, approval_mode: provided_approval_mode, on_approval_mode_change, on_submit, on_stop, on_respond_interaction, render_interaction, on_attach, on_create_thread, on_select_thread, on_archive_thread, on_load_more_threads, render_message, render_header_actions, render_footer, on_retry_message, retry_message_id, activity_host, status_panel, ...props }: DowncityChatPanelProps) {
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
  const history_anchor = useRef<{ /** Visible canonical row retained across a history request. */ element: HTMLElement; /** Row's viewport position before loading. */ top: number; /** Message array before the request, used to wait for a canonical update. */ messages: DowncityChatMessage[] } | undefined>(undefined);
  const scroll_snapshot = useRef({ first_id: messages[0]?.id, last_id: messages.at(-1)?.id, count: 0, height: 0, top: 0 });
  useLayoutEffect(() => {
    const element = conversation_ref.current;
    if (!element) return;
    const previous = scroll_snapshot.current;
    const prepended = previous.count > 0 && messages.length > previous.count && previous.first_id !== messages[0]?.id && previous.last_id === messages.at(-1)?.id;
    const anchor = history_anchor.current;
    if (anchor && anchor.messages !== messages) {
      if (anchor.element.isConnected) element.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    } else if (prepended) element.scrollTop = previous.top + element.scrollHeight - previous.height;
    else if (is_at_bottom && !anchor) element.scrollTop = element.scrollHeight;
    scroll_snapshot.current = { first_id: messages[0]?.id, last_id: messages.at(-1)?.id, count: messages.length, height: element.scrollHeight, top: element.scrollTop };
  }, [messages, is_at_bottom, earlier_loading, on_load_earlier]);
  const visible_messages = useMemo(() => messages.filter((message: DowncityChatMessage) => message.role !== "system"), [messages]);
  const translate_controls = useMemo(() => translate ? (key: string, values?: Record<string, string | number>) => {
    const result = translate(key, values);
    return result === key ? default_control_translate(key, values) : result;
  } : undefined, [translate]);
  return <ControlMessagesProvider translate={translate_controls}><ActivityProvider host={activity_host}><div className={cn("dc-chat-panel", className)} {...props}>
    {show_header ? <header className="dc-chat-header">{on_select_thread || threads.length ? <button type="button" onClick={() => set_show_history(value => !value)} title="历史会话">{show_history ? <ChevronLeft /> : <History />}</button> : null}<div className="dc-chat-header-title"><span>{title ?? thread?.title ?? "新对话"}</span>{thread?.updated_at ? <small>{format_thread_time(thread.updated_at)}</small> : null}</div><div className="dc-chat-header-drag" />{on_create_thread ? <button type="button" onClick={() => void on_create_thread()} title="新建会话"><Plus /></button> : null}{render_header_actions?.()}</header> : null}
    {show_history ? <ChatHistory threads={threads} current_thread_id={thread?.id} loading={history_loading} has_more={has_more_threads} on_select={(thread_id) => { set_show_history(false); return on_select_thread?.(thread_id); }} on_archive={on_archive_thread} on_load_more={on_load_more_threads} /> : <div className="dc-chat-body">
      <div className="dc-chat-conversation" ref={conversation_ref} role="log" onScroll={(event) => { const target = event.currentTarget; scroll_snapshot.current.top = target.scrollTop; scroll_snapshot.current.height = target.scrollHeight; set_is_at_bottom(target.scrollHeight - target.scrollTop - target.clientHeight < 24); }}><div className="dc-chat-conversation-content">{on_load_earlier || earlier_loading || earlier_error ? <div className="dc-chat-earlier">{on_load_earlier ? <button type="button" disabled={earlier_loading} onClick={() => {
        const scroll_area = conversation_ref.current;
        const top = scroll_area?.getBoundingClientRect().top ?? 0;
        const row = [...(scroll_area?.querySelectorAll<HTMLElement>("article") ?? [])].find(item => item.getBoundingClientRect().bottom > top);
        if (row) history_anchor.current = { element: row, top: row.getBoundingClientRect().top, messages };
        const request_anchor = history_anchor.current;
        void Promise.resolve().then(on_load_earlier).catch(() => {}).finally(() => {
          // Wait for both the runtime prepend and host loading/control updates to commit.
          requestAnimationFrame(() => requestAnimationFrame(() => { if (history_anchor.current === request_anchor) history_anchor.current = undefined; }));
        });
      }}>{earlier_loading ? <LoaderCircle className="animate-spin" size={12} /> : null}{earlier_loading ? earlier_loading_label : earlier_label}</button> : null}{earlier_error ? <p role="alert">{earlier_error}</p> : null}</div> : null}{visible_messages.length ? visible_messages.map((message: DowncityChatMessage) => <ChatMessage key={message.id} message={message} agent={agent} retry_message_id={runtime_snapshot?.retry_message_id ?? retry_message_id} on_retry_message={runtime ? id => runtime.retry(id) : on_retry_message} render_message={render_message} on_respond_interaction={runtime ? (id, response) => runtime.respond_interaction(id, response) : on_respond_interaction} render_interaction={render_interaction} />) : <div className="dc-chat-empty"><MessageCircle /><h2>{empty_title}</h2><p>{empty_description}</p></div>}{runtime_snapshot?.error ? <p role="alert" className="text-xs text-destructive">{runtime_snapshot.error}</p> : null}{render_footer?.()}</div></div>
      {!is_at_bottom ? <button className="dc-chat-scroll-button" aria-label="Scroll to latest message" onClick={() => conversation_ref.current?.scrollTo({ top: conversation_ref.current.scrollHeight, behavior: "smooth" })}><ArrowDown /></button> : null}
      <ChatComposer translate={translate_controls} key={runtime_snapshot?.session_id ?? thread?.id ?? "chat-panel"} editor_key={runtime_snapshot?.session_id ?? thread?.id ?? "chat-panel"} status={status} input_placeholder={input_placeholder} model_options={model_options} model_id={model_id} on_model_change={on_model_change ? async next_model_id => { await on_model_change(next_model_id); runtime?.set_model(next_model_id); } : undefined} approval_mode={approval_mode} on_approval_mode_change={on_approval_mode_change ? async next_mode => { await on_approval_mode_change(next_mode); runtime?.set_approval_mode(next_mode); } : undefined} on_submit={(input, mode = "send") => runtime ? runtime.submit(input, mode) : on_submit?.(input, mode)} on_stop={() => runtime ? runtime.stop() : on_stop?.()} on_attach={on_attach} composer_status={{ runtime, snapshot: runtime_snapshot ?? undefined, status_panel, interactions: message_pending_interactions(messages), respond: runtime ? (id, response) => runtime.respond_interaction(id, response) : on_respond_interaction }} />
    </div>}
  </div></ActivityProvider></ControlMessagesProvider>;
}
