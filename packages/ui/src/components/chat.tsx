/**
 * Downcity Chat UI 组件。
 *
 * 组件是受控的展示层，不读取宿主状态，也不执行 Agent 请求。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Archive, Bot, ChevronLeft, LoaderCircle, MessageCircle, Plus, Send, Square, User } from "lucide-react";
import { cn } from "../lib/utils";
import type { DowncityChatMessage, DowncityChatPanelProps, DowncityChatSubmitInput, DowncityChatThread } from "../types/chat";

function format_thread_time(value: DowncityChatThread["updated_at"]): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function ChatMessage({ message, render_message }: Pick<DowncityChatPanelProps, "render_message"> & { message: DowncityChatMessage }) {
  const rendered_content = render_message?.({ message });
  const is_user = message.role === "user";
  const is_error = message.role === "error";
  if (message.role === "system") return null;
  return (
    <article className={cn("dc-chat-message", is_user && "dc-chat-message-user", is_error && "dc-chat-message-error")} data-role={message.role}>
      <div className="dc-chat-message-avatar" aria-hidden="true">{is_user ? <User /> : <Bot />}</div>
      <div className="dc-chat-message-body">
        <div className="dc-chat-message-content">{rendered_content ?? message.content}</div>
        {message.activity ? <div className="dc-chat-message-activity">{message.activity}</div> : null}
        {message.attachments?.length ? <div className="dc-chat-attachments">{message.attachments.map((attachment) => <span className="dc-chat-attachment" key={attachment.id}>{attachment.name}</span>)}</div> : null}
      </div>
    </article>
  );
}

function ChatComposer({ status = "ready", input_placeholder, on_submit, on_stop }: Pick<DowncityChatPanelProps, "status" | "input_placeholder" | "on_submit" | "on_stop">) {
  const [text, set_text] = useState("");
  const is_busy = status === "submitted" || status === "streaming";
  const submit = useCallback(async () => {
    const normalized_text = text.trim();
    if (!normalized_text || !on_submit || is_busy) return;
    const input: DowncityChatSubmitInput = { text: normalized_text, attachments: [] };
    set_text("");
    await on_submit(input);
  }, [is_busy, on_submit, text]);
  return (
    <div className="dc-chat-composer-wrap">
      <div className="dc-chat-composer">
        <textarea value={text} placeholder={input_placeholder ?? "输入消息…"} rows={1} onChange={(event) => set_text(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} aria-label={input_placeholder ?? "输入消息"} />
        <button type="button" className="dc-chat-composer-action" disabled={is_busy ? !on_stop : !text.trim() || !on_submit} onClick={() => (is_busy ? void on_stop?.() : void submit())} aria-label={is_busy ? "停止生成" : "发送消息"}>
          {is_busy ? <Square /> : <Send />}
        </button>
      </div>
      <div className="dc-chat-composer-hint">Enter 发送 · Shift+Enter 换行</div>
    </div>
  );
}

function ChatHistory({ threads, current_thread_id, loading, has_more, on_select, on_archive, on_load_more }: { threads: DowncityChatThread[]; current_thread_id?: string; loading?: boolean; has_more?: boolean; on_select?: DowncityChatPanelProps["on_select_thread"]; on_archive?: DowncityChatPanelProps["on_archive_thread"]; on_load_more?: DowncityChatPanelProps["on_load_more_threads"] }) {
  return (
    <aside className="dc-chat-history" aria-label="会话历史">
      <div className="dc-chat-history-title"><MessageCircle /> <span>历史会话</span></div>
      <div className="dc-chat-history-list">
        {threads.map((thread) => <div className={cn("dc-chat-thread", thread.id === current_thread_id && "is-active")} key={thread.id}>
          <button type="button" className="dc-chat-thread-select" onClick={() => void on_select?.(thread.id)}><span className="dc-chat-thread-title">{thread.title || "未命名会话"}</span><span className="dc-chat-thread-time">{format_thread_time(thread.updated_at)}</span>{thread.unread ? <span className="dc-chat-thread-unread" /> : null}</button>
          {on_archive ? <button type="button" className="dc-chat-thread-archive" onClick={() => void on_archive(thread.id)} aria-label="归档会话"><Archive /></button> : null}
        </div>)}
        {!threads.length && !loading ? <div className="dc-chat-history-empty">暂无历史会话</div> : null}
        {loading ? <div className="dc-chat-history-loading"><LoaderCircle className="animate-spin" /> 加载中…</div> : null}
        {has_more && !loading ? <button type="button" className="dc-chat-history-more" onClick={() => void on_load_more?.()}>加载更多</button> : null}
      </div>
    </aside>
  );
}

/** 通用 Chat 面板，负责组合标题、历史、消息和输入区域。 */
export function ChatPanel({ className, thread, threads = [], messages = [], status = "ready", history_open = false, history_loading, has_more_threads, title, empty_title = "开始一段新对话", empty_description = "输入消息，与 Agent 开始交流。", input_placeholder, on_submit, on_stop, on_create_thread, on_select_thread, on_archive_thread, on_load_more_threads, render_message, render_header_actions, render_footer, ...props }: DowncityChatPanelProps) {
  const conversation_ref = useRef<HTMLDivElement>(null);
  const [show_history, set_show_history] = useState(history_open);
  useEffect(() => set_show_history(history_open), [history_open]);
  const scroll_to_bottom = useCallback(() => conversation_ref.current?.scrollTo({ top: conversation_ref.current.scrollHeight, behavior: "smooth" }), []);
  return (
    <div className={cn("dc-chat-panel", className)} {...props}>
      <header className="dc-chat-header">
        {show_history ? <button type="button" className="dc-chat-icon-button" onClick={() => set_show_history(false)} aria-label="返回对话"><ChevronLeft /></button> : null}
        <div className="dc-chat-header-title"><MessageCircle /><span>{title ?? thread?.title ?? "Chat"}</span></div>
        <div className="dc-chat-header-actions">
          <button type="button" className="dc-chat-icon-button" onClick={() => void on_create_thread?.()} aria-label="新建会话"><Plus /></button>
          <button type="button" className="dc-chat-icon-button" onClick={() => set_show_history((value) => !value)} aria-label="会话历史"><Archive /></button>
          {render_header_actions?.()}
        </div>
      </header>
      <div className="dc-chat-body">
        {show_history ? <ChatHistory threads={threads} current_thread_id={thread?.id} loading={history_loading} has_more={has_more_threads} on_select={on_select_thread} on_archive={on_archive_thread} on_load_more={on_load_more_threads} /> : <>
          <div className="dc-chat-conversation" ref={conversation_ref}>
            {messages.length ? messages.map((message) => <ChatMessage key={message.id} message={message} render_message={render_message} />) : <div className="dc-chat-empty"><div className="dc-chat-empty-icon"><Bot /></div><h2>{empty_title}</h2><p>{empty_description}</p></div>}
          </div>
          {messages.length ? <button type="button" className="dc-chat-scroll-button" onClick={scroll_to_bottom} aria-label="滚动到底部"><ArrowDown /></button> : null}
          {render_footer?.()}
          <ChatComposer status={status} input_placeholder={input_placeholder} on_submit={on_submit} on_stop={on_stop} />
        </>}
      </div>
    </div>
  );
}

export { ChatComposer, ChatHistory, ChatMessage };
