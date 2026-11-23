/** Agent 与用户消息的唯一通用展示实现；默认内容与 ChatPanel 共用，宿主只注入业务能力。 */
import { useRef, useState, type CSSProperties, type Ref } from "react";
import { Check, ChevronDown, ChevronUp, Copy, RefreshCw } from "lucide-react";
import { MarkdownView } from "./markdown/MarkdownView";
import { MarkdownViewProvider } from "./markdown/markdown_host_context";
import { get_markdown_text_size } from "./markdown/markdown_text_size";
import { render_message_parts } from "./chat-parts";
import { build_user_message_preview } from "../lib/user-message-preview";
import { cn } from "../lib/utils";
import * as layout from "../lib/message-layout";
import type { AgentMessageProps, UserMessageProps } from "../types/chat-message";

/** Chat 使用左侧气泡，运行状态位于气泡内部顶部，身份与操作位于气泡外。 */
export function AgentChatMessage(props: AgentMessageProps) {
  return <AgentMessageFrame {...props} surface="chat" />;
}

/** Work 使用无身份行的紧凑文稿布局，保留完整正文宽度。 */
export function AgentWorkMessage(props: AgentMessageProps) {
  return <AgentMessageFrame {...props} surface="work" />;
}

/** 两种表面共用内容与动作行为，布局由显式入口决定。 */
function AgentMessageFrame({ message, agent = { agent_id: "agent", name: "Agent" }, children, show_identity = true, continues_previous = false, continues_next = false, surface, created_at = typeof message?.created_at === "number" ? message.created_at : undefined, avatar, timestamp, identity_action, identity_title, identity_label, suffix, header_action, actions, status, footer, busy = message?.is_streaming ?? false, row_ref, semantic = "message", on_respond_interaction, render_interaction, retry_message, can_retry = false }: AgentMessageProps & { /** 由 Chat 或 Work 入口指定的展示表面。 */ surface: "chat" | "work" }) {
  const compact = surface === "work";
  const [copied, set_copied] = useState(false);
  const [pending, set_pending] = useState(false);
  const pending_ref = useRef(false);
  const [error, set_error] = useState<string>();
  const name = agent.name || "Agent";
  const text = message?.parts?.flatMap(part => part.type === "text" && "text" in part ? [part.text ?? ""] : []).join("\n") || message?.content || "";
  const has_content = children !== undefined ? children !== null && children !== false : !!(message?.parts?.length || text);
  const copy_message = async () => {
    try { await navigator.clipboard.writeText(text); set_copied(true); } catch (reason) { set_error(String(reason)); }
  };
  const retry = async () => {
    if (!message || !retry_message || !can_retry || pending_ref.current) return;
    pending_ref.current = true; set_pending(true); set_error(undefined);
    try { await retry_message(message.id); } catch (reason) { set_error(String(reason)); }
    finally { pending_ref.current = false; set_pending(false); }
  };
  const identity_avatar = avatar ?? (agent.avatar_url ? <img src={agent.avatar_url} alt="" className={cn(layout.agent_identity_avatar_class_name, "rounded-full object-cover")} /> : <span aria-hidden className={cn(layout.agent_identity_avatar_class_name, "inline-flex items-center justify-center rounded-full bg-surface-emphasis text-xs")}>{name.slice(0, 1)}</span>);
  const identity = <span className={layout.agent_identity_name_class_name}>{name}</span>;
  const identity_button_class_name = "rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring/30 max-w-full transition-opacity hover:opacity-75";
  const avatar_column = compact ? null : <div className={layout.agent_message_avatar_column_class_name}>
    {show_identity ? identity_action ? <button type="button" onClick={identity_action} title={identity_title} aria-label={identity_label ?? identity_title ?? name} className={identity_button_class_name}>{identity_avatar}</button> : identity_avatar : null}
  </div>;
  const content = <div className={cn(layout.agent_message_stack_class_name, compact && "gap-1")}>
    {show_identity && !compact ? <header className={layout.agent_message_identity_header_class_name}>
      {identity_action ? <button type="button" onClick={identity_action} title={identity_title} aria-label={identity_label ?? identity_title ?? name} className={cn(layout.agent_identity_row_class_name, identity_button_class_name)}>{identity}</button> : <div className={layout.agent_identity_row_class_name}>{identity}</div>}
      {suffix}{timestamp ?? (created_at ? <time className={layout.agent_message_timestamp_class_name} dateTime={new Date(created_at).toISOString()}>{new Date(created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null)}
      {header_action ? <div className="ml-auto shrink-0">{header_action}</div> : null}
    </header> : null}
    {has_content || (!compact && status) || actions || error ? <div className={layout.agent_message_body_class_name}>
      {has_content || (!compact && status) ? <div className={cn(compact ? layout.agent_message_work_content_class_name : layout.agent_message_bubble_class_name, !compact && "flex flex-col gap-2")}>
        {!compact && status ? <div className={layout.agent_message_status_class_name}>{status}</div> : null}
        {has_content ? children ?? <div className={layout.agent_message_content_class_name}>{message?.parts?.length ? render_message_parts(message.parts, on_respond_interaction, render_interaction, busy) : <MarkdownView text={text} mode={busy ? "streaming" : "static"} layout="embedded" />}</div> : null}
      </div> : null}
      {actions !== undefined ? actions : !busy && text ? <div className={layout.agent_message_actions_class_name}><button type="button" title="Copy" aria-label="Copy" onClick={() => void copy_message()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button>{retry_message ? <button type="button" disabled={!can_retry || pending} onClick={() => void retry()}><RefreshCw className="size-3.5" />Retry</button> : null}</div> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div> : null}
    {footer || (compact && status) ? <div className={layout.agent_message_footer_class_name}>{compact ? status : null}{footer}</div> : null}
  </div>;
  const class_name = cn(layout.agent_message_root_class_name, compact ? layout.agent_message_work_class_name : layout.agent_message_chat_class_name, continues_previous && layout.agent_message_continuation_class_name, continues_next && layout.agent_message_continues_class_name);
  return semantic === "status" ? <div ref={row_ref as Ref<HTMLDivElement>} className={class_name}>{avatar_column}{content}</div> : <article ref={row_ref} className={class_name} aria-busy={busy}>{avatar_column}{content}</article>;
}

/** 用户消息的受控/非受控长文本折叠，与正文编辑使用同一入口。 */
export function UserMessageBody({ children, preview, expanded: controlled_expanded, on_expanded_change, expand_label = "Show more", collapse_label = "Show less" }: Pick<UserMessageProps, "children" | "preview" | "expanded" | "on_expanded_change" | "expand_label" | "collapse_label">) {
  const [local_expanded, set_local_expanded] = useState(false);
  const expanded = controlled_expanded ?? local_expanded;
  if (!preview) return children;
  const toggle = () => { set_local_expanded(!expanded); on_expanded_change?.(!expanded); };
  return <>{expanded ? children : preview.plain ? <div className={cn("whitespace-pre-wrap break-words", layout.user_message_text_class_name)}>{preview.text}</div> : <MarkdownView text={preview.text} mode="static" layout="embedded" />}<button type="button" aria-expanded={expanded} onClick={toggle} className={layout.user_message_collapse_button_class_name}>{expanded ? collapse_label : expand_label}{expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}</button></>;
}

/** 用户正文、附件与编辑器共用右对齐气泡和元信息布局。 */
export function UserMessage({ message, children, meta, editing = false, compact = false, text_size = "small", style, ...body_props }: UserMessageProps) {
  const text = message?.parts?.flatMap(part => part.type === "text" && "text" in part ? [part.text ?? ""] : []).join("\n") || message?.content || "";
  const default_preview = build_user_message_preview(text);
  const text_style = { "--chat-text-size": get_markdown_text_size(text_size), ...style } as CSSProperties;
  const body = children ?? <>{message?.parts?.length ? render_message_parts(message.parts) : <MarkdownView text={text} mode="static" layout="embedded" />}</>;
  return <article className={cn(layout.user_message_root_class_name, compact && "py-2")}><div className="flex w-full justify-end"><div className={cn(layout.user_message_stack_class_name, editing ? layout.user_message_stack_expanded_class_name : layout.user_message_stack_max_class_name)}><div className={editing ? layout.user_message_editor_class_name : layout.user_message_bubble_class_name} style={editing ? undefined : text_style}>{editing ? body : <MarkdownViewProvider text_size={text_size}><UserMessageBody preview={children === undefined ? default_preview : undefined} {...body_props}>{body}</UserMessageBody></MarkdownViewProvider>}</div>{meta ? <div className={layout.user_message_meta_class_name}>{meta}</div> : null}</div></div></article>;
}
