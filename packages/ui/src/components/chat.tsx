/**
 * Duobox Chat Panel 的通用受控实现。
 *
 * 组件复刻消息、活动、历史和输入区的 DOM 层级；Session、审批响应、文件读取、
 * 模型选择和草稿持久化由宿主通过回调拥有。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, CircleStop, Copy, File, FilePenLine, History, LoaderCircle, MessageCircle, MoreHorizontal, Paperclip, Plus, Send, Terminal, X } from "lucide-react";
import { TbArrowUp, TbCheck, TbChevronDown, TbChevronRight, TbFile as TbFileIcon, TbLoader2, TbLock, TbPaperclip, TbPlus, TbRobot, TbShieldCheck, TbSquare, TbTerminal } from "./chat-icons";
import { cn } from "../lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import type { DowncityChatApprovalMode, DowncityChatChangedFile, DowncityChatMessage, DowncityChatMessagePart, DowncityChatModelOption, DowncityChatPanelProps, DowncityChatQuestion, DowncityChatSubmitInput, DowncityChatThread } from "../types/chat";
import type { DowncityChatQueuedInput } from "../types/chat-runtime";

function format_thread_time(value: DowncityChatThread["updated_at"]): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function format_value(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function ThinkingDots() {
  return <span className="dc-chat-thinking-dots" aria-hidden>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>;
}

function ToolActivity({ part }: { part: DowncityChatMessagePart }) {
  const is_running = part.tool_state === "running" || part.tool_state === "input-streaming";
  const is_failed = part.tool_state === "failed" || Boolean(part.error);
  const is_file_tool = /write|edit|patch|file/i.test(part.tool_name ?? "");
  const state_label = is_failed ? "失败" : is_running ? "执行中" : "已完成";
  return (
    <details className={cn("dc-chat-activity-row", is_running && "is-running", is_failed && "is-failed")} open={part.tool_state === "input-streaming"}>
      <summary className="dc-chat-activity-summary">
        <span className="dc-chat-activity-main">
          {is_file_tool ? <TbFileIcon /> : <TbTerminal />}
          <span className="dc-chat-activity-state">{state_label}</span>
          <span className="dc-chat-activity-name">{part.tool_display_name ?? part.tool_name ?? "工具调用"}</span>
          <TbChevronRight className="dc-chat-activity-chevron" />
        </span>
      </summary>
      <div className="dc-chat-activity-terminal">
        {part.interaction_id ? <div className="dc-chat-tool-interaction"><strong>{part.title ?? (part.interaction_type === "approval" ? "需要批准" : "需要输入")}</strong><span>{part.description}</span></div> : null}
        {part.input !== undefined ? <pre><span className="dc-chat-command-prompt">› input</span>{"\n"}{format_value(part.input)}{part.tool_state === "input-streaming" ? <span className="dc-chat-input-caret" /> : null}</pre> : null}
        {part.output !== undefined || part.error ? <pre><span className="dc-chat-command-prompt">› output</span>{"\n"}{part.error ?? format_value(part.output)}</pre> : null}
      </div>
    </details>
  );
}

function ReasoningActivity({ part }: { part: DowncityChatMessagePart }) {
  const is_running = part.state === "streaming" || part.state === "running";
  return <details className={cn("dc-chat-activity-row", "dc-chat-reasoning-row", is_running && "is-running")}>
    <summary className="dc-chat-activity-summary"><span className="dc-chat-activity-main">{is_running ? <ThinkingDots /> : <TbCheck />}<span className="dc-chat-activity-state">{is_running ? "正在思考" : "已思考"}</span><span className="dc-chat-activity-name">{part.text?.replace(/\s+/g, " ").trim()}</span><TbChevronRight className="dc-chat-activity-chevron" /></span></summary>
    <div className="dc-chat-reasoning-content">{part.text}</div>
  </details>;
}

function InteractionCard({ part, on_respond_interaction }: { part: DowncityChatMessagePart; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"] }) {
  const [submitted, set_submitted] = useState(false);
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [answers, set_answers] = useState<Record<string, string | string[]>>({});
  if (submitted) return null;
  if (part.interaction_type !== "approval" && part.interaction_type !== "question") {
    return <section className="dc-chat-interaction-card" aria-label="需要操作"><header><span>{part.title ?? part.interaction_type ?? "需要操作"}</span><small>{part.interaction_status ?? "等待响应"}</small></header><div className="dc-chat-interaction-body"><p>{part.description}</p><p>此交互类型由宿主应用自定义呈现。</p></div></section>;
  }
  const questions = part.questions ?? [];
  const has_empty_answer = questions.some((question) => {
    const value = answers[question.id];
    return Array.isArray(value) ? value.length === 0 : !value?.trim();
  });
  const respond = async (response: unknown) => {
    if (!part.interaction_id) return;
    set_submitting(true);
    set_error(null);
    try {
      await on_respond_interaction?.(part.interaction_id, response);
      set_submitted(true);
    } catch (reason) {
      set_error(String(reason));
    } finally {
      set_submitting(false);
    }
  };
  return <section className="dc-chat-interaction-card" aria-label={typeof part.title === "string" ? part.title : "需要操作"}>
    <header><span>{part.title ?? (part.interaction_type === "approval" ? "需要批准" : "需要输入")}</span><small>{submitting ? "提交中" : part.interaction_status ?? "等待响应"}</small></header>
    <div className="dc-chat-interaction-body">{part.description}{questions.map((question) => <QuestionField key={question.id} question={question} value={answers[question.id] ?? (question.response_type === "multi_select" ? [] : "")} on_change={(value) => set_answers((current) => ({ ...current, [question.id]: value }))} />)}{error ? <small className="dc-chat-interaction-error">{error}</small> : null}</div>
    <footer>{part.interaction_type === "approval" ? <><button type="button" disabled={submitting} onClick={() => void respond({ type: "approval", outcome: "denied", payload: { decision: "denied" } })}>拒绝</button><button type="button" className="is-primary" disabled={submitting} onClick={() => void respond({ type: "approval", outcome: "resolved", payload: { decision: "approved" } })}>批准</button></> : <button type="button" className="is-primary" disabled={submitting || questions.length === 0 || has_empty_answer} onClick={() => void respond({ type: part.interaction_type ?? "question", outcome: "resolved", payload: { answers: questions.map((question) => ({ question_id: question.id, value: answers[question.id] })) } })}><Send />提交</button>}</footer>
  </section>;
}

function QuestionField({ question, value, on_change }: { question: DowncityChatQuestion; value: string | string[]; on_change: (value: string | string[]) => void }) {
  if (question.response_type === "text") return <label className="dc-chat-question"><span>{question.prompt}</span><textarea value={String(value)} onChange={(event) => on_change(event.target.value)} /></label>;
  const selected_values = Array.isArray(value) ? value : value ? [value] : [];
  return <fieldset className="dc-chat-question"><legend>{question.prompt}</legend>{question.options?.map((option) => <label key={option.value}><input type={question.response_type === "multi_select" ? "checkbox" : "radio"} name={question.id} value={option.value} checked={selected_values.includes(option.value)} onChange={() => on_change(question.response_type === "multi_select" ? selected_values.includes(option.value) ? selected_values.filter((item) => item !== option.value) : [...selected_values, option.value] : option.value)} />{option.label}</label>)}</fieldset>;
}

function ChangedFiles({ files = [] }: { files?: DowncityChatChangedFile[] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  if (!files.length) return null;
  return <details className="dc-chat-changed-files" open><summary><span>已更改 {files.length} 个文件</span><b>+{additions}</b><em>-{deletions}</em><ChevronDown /></summary><div>{files.map((file) => <details key={file.path}><summary><File /><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></summary>{file.diff ? <pre>{file.diff}</pre> : null}</details>)}</div></details>;
}

function render_part(part: DowncityChatMessagePart, on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"]): ReactNode {
  if (part.type === "text") return <MarkdownContent text={part.text ?? ""} />;
  if (part.type === "reasoning") return <ReasoningActivity part={part} />;
  if (part.type === "tool") return <ToolActivity part={part} />;
  if (part.type === "interaction") return render_interaction?.({ part, on_respond_interaction }) ?? <InteractionCard part={part} on_respond_interaction={on_respond_interaction} />;
  if (part.type === "changed-files") return <ChangedFiles files={part.files} />;
  if (part.type === "operation") return <div className="dc-chat-operation"><LoaderCircle className={part.operation?.status === "running" ? "animate-spin" : ""} /><span>{part.operation?.label ?? part.operation?.name}</span></div>;
  if (part.type === "file") return <span className="dc-chat-attachment"><File />{part.filename ?? "附件"}</span>;
  if (part.type === "source") return <a className="dc-chat-source" href={part.source_url}>{part.source_title ?? part.source_url}</a>;
  return null;
}

/** 按 Duobox MessageRenderer 的规则，把连续的 reasoning/tool/step-start 合并成一个 activity 区块。 */
function render_message_parts(parts: DowncityChatMessagePart[], on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let activity: DowncityChatMessagePart[] = [];
  const flush_activity = () => {
    if (!activity.length) return;
    nodes.push(<div className="dc-chat-activity-list" key={`activity-${nodes.length}`}>{activity.map((part) => <div className="dc-chat-part" key={part.id}>{render_part(part, on_respond_interaction, render_interaction)}</div>)}</div>);
    activity = [];
  };
  for (const part of parts) {
    if (part.type === "reasoning" || part.type === "tool" || part.type === "step-start") activity.push(part);
    else { flush_activity(); nodes.push(<div className="dc-chat-part" key={part.id}>{render_part(part, on_respond_interaction, render_interaction)}</div>); }
  }
  flush_activity();
  return nodes;
}

/** 轻量 Markdown 展示器：覆盖 Duobox 对话中最常见的标题、列表、代码块和强调。 */
function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let code_lines: string[] | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.trim().startsWith("```")) {
      if (code_lines) { nodes.push(<pre className="dc-chat-code-block" key={`code-${index}`}>{code_lines.join("\n")}</pre>); code_lines = null; }
      else code_lines = [];
      continue;
    }
    if (code_lines) { code_lines.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { nodes.push(<div className={`dc-chat-markdown-h${heading[1].length}`} key={index}>{heading[2]}</div>); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { nodes.push(<div className="dc-chat-markdown-li" key={index}>• {bullet[1]}</div>); continue; }
    if (!line.trim()) { nodes.push(<div className="dc-chat-markdown-break" key={index} />); continue; }
    nodes.push(<p key={index}>{line.split(/(\*\*[^*]+\*\*)/g).map((segment, segment_index) => segment.startsWith("**") ? <strong key={segment_index}>{segment.slice(2, -2)}</strong> : segment)}</p>);
  }
  if (code_lines) nodes.push(<pre className="dc-chat-code-block" key="code-last">{code_lines.join("\n")}</pre>);
  return <div className="dc-chat-markdown">{nodes}</div>;
}

/** 与 Duobox 消息布局一致的受控消息组件。 */
export function ChatMessage({ message, render_message, on_respond_interaction, render_interaction }: Pick<DowncityChatPanelProps, "render_message" | "on_respond_interaction" | "render_interaction"> & { message: DowncityChatMessage }) {
  const [copied, set_copied] = useState(false);
  if (message.role === "system") return null;
  const is_user = message.role === "user";
  const rendered = render_message?.({ message });
  const text = message.parts?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? message.content ?? "";
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => { set_copied(true); setTimeout(() => set_copied(false), 1200); }); };
  return <article className={cn("dc-chat-message", "group", is_user ? "is-user" : "is-assistant", message.role === "error" && "is-error")}>
    <div className={cn("dc-chat-message-content", is_user ? "dc-chat-user-message-content" : "dc-chat-assistant-message-content")}>
      {rendered ?? (message.parts?.length ? render_message_parts(message.parts, on_respond_interaction, render_interaction) : <div className="dc-chat-markdown">{message.content}</div>)}
      {message.attachments?.map((attachment) => <span className="dc-chat-attachment" key={attachment.id}><Paperclip />{attachment.name}</span>)}
      {!is_user && text ? <div className="dc-chat-message-actions"><button type="button" onClick={copy} title="复制">{copied ? <Check /> : <Copy />}</button><button type="button" title="更多"><MoreHorizontal /></button></div> : null}
    </div>
  </article>;
}

/** 直接组合消息列表；宿主可在自己的 Chat 页面中使用，不需要 ChatPanel 封装。 */
export function ChatMessageList({ messages, render_message, on_respond_interaction, render_interaction }: { messages: DowncityChatMessage[]; render_message?: DowncityChatPanelProps["render_message"]; on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"]; render_interaction?: DowncityChatPanelProps["render_interaction"] }) {
  return <div className="dc-chat-conversation-content">{messages.filter((message) => message.role !== "system").map((message) => <ChatMessage key={message.id} message={message} render_message={render_message} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction} />)}</div>;
}

type ChatComposerProps = Pick<DowncityChatPanelProps, "status" | "input_placeholder" | "on_submit" | "on_stop" | "on_attach" | "model_options" | "model_id" | "on_model_change" | "approval_mode" | "on_approval_mode_change"> & {
  /** 当前由 Chat runtime 持有的等待队列。 */ queued_inputs?: DowncityChatQueuedInput[];
  /** 删除等待队列中的一项。 */ on_remove_queued?: (input_id: string) => void;
  /** 调整等待队列中一项的顺序。 */ on_move_queued?: (input_id: string, direction: "up" | "down") => void;
};

/** 与 Duobox 输入壳结构一致的受控 Chat 输入组件。 */
export function ChatComposer({ status = "ready", input_placeholder, on_submit, on_stop, on_attach, model_options = [{ id: "default", label: "Default model" }], model_id = "default", on_model_change, approval_mode = "ask", on_approval_mode_change, queued_inputs = [], on_remove_queued, on_move_queued }: ChatComposerProps) {
  const [text, set_text] = useState("");
  const editor = useEditor({ extensions: [StarterKit.configure({ heading: false, codeBlock: false }), Placeholder.configure({ placeholder: input_placeholder ?? "输入消息…", emptyEditorClass: "is-editor-empty" })], editorProps: { attributes: { class: "chat-input-editor dc-chat-input-editor", "data-chat-input": "true", autocapitalize: "off", autocorrect: "off", spellcheck: "false" } }, onUpdate: ({ editor: current_editor }) => set_text(current_editor.getText()) });
  const is_streaming = status === "submitted" || status === "streaming" || status === "building-context";
  const submit = useCallback(async (mode: "send" | "queue" = "send") => {
    const normalized_text = text.trim();
    if (!normalized_text || !on_submit) return;
    const input: DowncityChatSubmitInput = { text: normalized_text, attachments: [] };
    editor?.commands.clearContent();
    set_text("");
    editor?.commands.focus();
    await on_submit(input, mode);
  }, [editor, on_submit, text]);
  return <div className="dc-chat-input-root">
    {queued_inputs.length ? <div className="dc-chat-queue">{queued_inputs.map((item, index) => <div key={item.id}><ArrowDown /><span>{item.text}</span><button type="button" title="上移" disabled={index === 0} onClick={() => on_move_queued?.(item.id, "up")}><ArrowUp /></button><button type="button" title="下移" disabled={index === queued_inputs.length - 1} onClick={() => on_move_queued?.(item.id, "down")}><ArrowDown /></button><button type="button" title="取消排队" onClick={() => on_remove_queued?.(item.id)}><X /></button></div>)}</div> : null}
    <div className="dc-chat-input-shell" aria-busy={is_streaming && !text.trim()}>
      <EditorContent editor={editor} onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit("queue");
          return;
        }
        if (event.shiftKey) return;
        const content = editor?.getJSON();
        const is_single_paragraph = Boolean(content?.type === "doc" && content.content?.length === 1 && content.content[0]?.type === "paragraph");
        if (!event.metaKey && !event.ctrlKey && (!is_single_paragraph || text.includes("\n"))) return;
        event.preventDefault();
        void submit("send");
      }} />
      <div className="dc-chat-input-toolbar"><div><button type="button" onClick={on_attach} title="添加附件"><TbPlus /></button><DropdownMenu><DropdownMenuTrigger render={<button type="button" className="dc-chat-input-chip" />}><TbRobot /><span>{model_options.find((option) => option.id === model_id)?.label ?? "Default model"}</span><TbChevronDown /></DropdownMenuTrigger><DropdownMenuContent side="top" align="start">{model_options.map((option) => <DropdownMenuItem key={option.id} onClick={() => void on_model_change?.(option.id)}>{option.id === model_id ? "✓" : ""}<span>{option.label}</span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><DropdownMenu><DropdownMenuTrigger render={<button type="button" className="dc-chat-input-chip" />}>{approval_mode === "ask" ? <TbLock /> : <TbShieldCheck />}<span>{approval_mode === "ask" ? "Ask" : "Always allow"}</span><TbChevronDown /></DropdownMenuTrigger><DropdownMenuContent side="top" align="start"><DropdownMenuItem onClick={() => void on_approval_mode_change?.("ask")}><TbLock /><span>Ask</span></DropdownMenuItem><DropdownMenuItem onClick={() => void on_approval_mode_change?.("always-allow")}><TbShieldCheck /><span>Always allow</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><button type="button" className="dc-chat-send" disabled={!is_streaming && !text.trim()} onClick={() => is_streaming && !text.trim() ? void on_stop?.() : void submit(is_streaming ? "queue" : "send")} title={is_streaming && !text.trim() ? "停止生成" : "发送消息"}>{is_streaming && !text.trim() ? <TbSquare /> : <TbArrowUp />}</button></div>
    </div>
  </div>;
}

/** Duobox 风格历史列表。 */
export function ChatHistory({ threads, current_thread_id, loading, has_more, on_select, on_archive, on_load_more }: { threads: DowncityChatThread[]; current_thread_id?: string; loading?: boolean; has_more?: boolean; on_select?: DowncityChatPanelProps["on_select_thread"]; on_archive?: DowncityChatPanelProps["on_archive_thread"]; on_load_more?: DowncityChatPanelProps["on_load_more_threads"] }) {
  return <aside className="dc-chat-history"><header><div><MessageCircle /><span>Chat</span></div><small>历史会话</small></header><div className="dc-chat-history-list">{threads.map((thread) => <div className={cn("dc-chat-thread", thread.id === current_thread_id && "is-active")} key={thread.id}><button onClick={() => void on_select?.(thread.id)}><span>{thread.title || "未命名会话"}</span><small>{format_thread_time(thread.updated_at)}</small></button>{thread.unread ? <i /> : null}{on_archive ? <button className="dc-chat-thread-menu" onClick={() => void on_archive(thread.id)}><Archive /></button> : null}</div>)}{loading ? <div className="dc-chat-history-state"><LoaderCircle className="animate-spin" />加载中…</div> : null}{has_more ? <button className="dc-chat-history-more" onClick={() => void on_load_more?.()}>加载更多</button> : null}</div></aside>;
}

/** 组合顶部栏、对话滚动区、消息和输入区的通用 Chat Panel。 */
export function ChatPanel({ className, runtime, thread, threads = [], messages: provided_messages = [], status: provided_status = "ready", history_open = false, history_loading, has_more_threads, title, empty_title = "开始一段新对话", empty_description = "输入消息，与 Agent 开始交流。", input_placeholder, model_options: provided_model_options, model_id: provided_model_id, on_model_change, approval_mode: provided_approval_mode, on_approval_mode_change, on_submit, on_stop, on_respond_interaction, render_interaction, on_attach, on_create_thread, on_select_thread, on_archive_thread, on_load_more_threads, render_message, render_header_actions, render_footer, ...props }: DowncityChatPanelProps) {
  const runtime_snapshot = runtime ? useSyncExternalStore(runtime.subscribe.bind(runtime), () => runtime.get_snapshot(), () => runtime.get_snapshot()) : null;
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
    <header className="dc-chat-header"><button type="button" onClick={() => set_show_history((value) => !value)} title="历史会话">{show_history ? <ChevronLeft /> : <History />}</button><div className="dc-chat-header-title"><span>{title ?? thread?.title ?? "新对话"}</span>{thread?.updated_at ? <small>{format_thread_time(thread.updated_at)}</small> : null}</div><div className="dc-chat-header-drag" /><button type="button" onClick={() => void on_create_thread?.()} title="新建会话"><Plus /></button>{render_header_actions?.()}</header>
    {show_history ? <ChatHistory threads={threads} current_thread_id={thread?.id} loading={history_loading} has_more={has_more_threads} on_select={(thread_id) => { set_show_history(false); return on_select_thread?.(thread_id); }} on_archive={on_archive_thread} on_load_more={on_load_more_threads} /> : <div className="dc-chat-body">
      <div className="dc-chat-conversation" ref={conversation_ref} role="log" onScroll={(event) => { const target = event.currentTarget; set_is_at_bottom(target.scrollHeight - target.scrollTop - target.clientHeight < 24); }}><div className="dc-chat-conversation-content">{visible_messages.length ? visible_messages.map((message: DowncityChatMessage) => <ChatMessage key={message.id} message={message} render_message={render_message} on_respond_interaction={on_respond_interaction} render_interaction={render_interaction} />) : <div className="dc-chat-empty"><MessageCircle /><h2>{empty_title}</h2><p>{empty_description}</p></div>}{render_footer?.()}</div></div>
      {!is_at_bottom ? <button className="dc-chat-scroll-button" onClick={() => conversation_ref.current?.scrollTo({ top: conversation_ref.current.scrollHeight, behavior: "smooth" })}><ArrowDown /></button> : null}
      <ChatComposer status={status} input_placeholder={input_placeholder} model_options={model_options} model_id={model_id} on_model_change={(next_model_id) => { runtime?.set_model(next_model_id); return on_model_change?.(next_model_id); }} approval_mode={approval_mode} on_approval_mode_change={(next_mode) => { runtime?.set_approval_mode(next_mode); return on_approval_mode_change?.(next_mode); }} on_submit={(input, mode = "send") => runtime ? runtime.submit(input, mode) : on_submit?.(input, mode)} on_stop={() => runtime ? runtime.stop() : on_stop?.()} on_attach={on_attach} queued_inputs={runtime_snapshot?.queued_inputs} on_remove_queued={(input_id) => runtime?.remove_queued_input(input_id)} on_move_queued={(input_id, direction) => runtime?.move_queued_input(input_id, direction)} />
    </div>}
  </div>;
}
