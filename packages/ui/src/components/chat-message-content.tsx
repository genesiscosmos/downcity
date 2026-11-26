/** 消息内容的共享展示：canonical 顺序、流式 Markdown、错误重试与用户引用均由 SDK 持有。 */
import { Fragment, useRef, useState } from "react";
import { AlertTriangle, File, RefreshCw } from "lucide-react";
import { is_messenger_runtime_context_tag } from "@downcity/type";
import { MarkdownView } from "./markdown/MarkdownView";
import { AgentText } from "./markdown/AgentText";
import { Button } from "./button";
import { render_message_parts } from "./chat-parts";
import { is_chat_reference_tag } from "./chat-input/session-reference";
import { session_message_to_chat_message } from "../lib/session-message";
import { cn } from "../lib/utils";
import { agent_message_actions_group_class_name, agent_message_content_class_name } from "../lib/message-layout";
import type { AgentMessageBlock, AgentMessageContentProps, UserMessageContentProps } from "../types/chat-blocks";

/** 完整 Agent 正文：宿主可替换业务块，SDK 始终拥有文本、错误与重试生命周期。 */
export function AgentMessageContent({ message_id, blocks, streaming, smooth = true, actions, render_block, retry_error_part_id, show_errors = true, retry_message, can_retry = false, retry_label = "Retry", file_label = "File", on_respond_interaction, render_interaction }: AgentMessageContentProps) {
  const pending_ref = useRef(false);
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState<string>();
  const retry = async () => {
    if (!retry_message || !can_retry || pending_ref.current) return;
    pending_ref.current = true; set_pending(true); set_error(undefined);
    try { await retry_message(message_id); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending_ref.current = false; set_pending(false); }
  };
  const smooth_text = smooth && !blocks.some(block => block.type === "error");
  const render = (block: AgentMessageBlock) => {
    if (block.type === "text") return <div data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="agent" className="min-h-[1lh]"><AgentText text={block.part.text} streaming={streaming && block.part.state === "streaming"} smooth={smooth_text} /></div>;
    if (block.type === "file") return <a href={block.part.url} className="agent-message-resource" target="_blank" rel="noreferrer"><File aria-hidden /><span>{block.part.filename || file_label}</span></a>;
    if (block.type === "error") {
      if (!show_errors) return null;
      const retryable = block.part.part_id === retry_error_part_id;
      return <div role="alert" className="min-w-0 w-full rounded-item bg-surface-subtle px-2.5 py-2"><div className="flex min-w-0 items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" aria-hidden /><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{block.part.message}</p>{retry_message && retryable ? <Button type="button" variant="ghost" size="xs" className="focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5" disabled={!can_retry || pending} onClick={() => void retry()}><RefreshCw aria-hidden />{retry_label}</Button> : null}</div>{retryable && error ? <p role="alert" className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">{error}</p> : null}</div>;
    }
    const custom = render_block?.(block);
    if (custom !== undefined) return custom;
    if (block.type === "file-diff") return <details><summary>+{block.data.additions} −{block.data.deletions}</summary>{block.data.files.map(file => <details key={file.file}><summary>{file.file}</summary><pre>{file.patch}</pre></details>)}</details>;
    if (block.type === "attachment") return <span className="text-xs">{block.file.caption || block.file.path || block.source}</span>;
    const parts = block.type === "activity" ? block.parts : [block.part];
    const projected = session_message_to_chat_message({ message_id, role: "agent", parts });
    return render_message_parts(projected.parts ?? [], on_respond_interaction, render_interaction, streaming);
  };
  if (!blocks.length) return null;
  return <div className={agent_message_actions_group_class_name}><div data-chat-content-region={message_id} className={agent_message_content_class_name}>{blocks.map(block => <Fragment key={block_key(block)}>{render(block)}</Fragment>)}</div>{actions}</div>;
}

/** Power 预览发布后沿用工具来源键，流式阶段不重新挂载业务界面。 */
function block_key(block: AgentMessageBlock): string {
  if (block.type === "view" && block.part.source_tool_call_id) return `power-source:${block.part.source_tool_call_id}`;
  if (block.type === "attachment") return `${block.part.part_id}:attachment:${block.offset}`;
  return block.type === "activity" ? block.parts[0]?.part_id ?? "activity" : block.part.part_id;
}

/** 用户正文的默认内容已完整可用，宿主只替换受权限约束的文件与引用预览。 */
export function UserMessageContent({ message_id, parts, render_file, render_reference }: UserMessageContentProps) {
  return <div className="user-message-content downcity-writing-text chat-text-size-content" data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="user">{parts.map(part => {
    if (part.type === "text") return part.text ? <div key={part.part_id} className={cn("user-message-text-part", is_inline_text(part.text) && "is-inline")}><MarkdownView layout="embedded" text={part.text} mode="static" /></div> : null;
    if (part.type === "context" && is_messenger_runtime_context_tag(part.tag)) return null;
    if (part.type === "context" && is_chat_reference_tag(part.tag)) return <Fragment key={part.part_id}>{render_reference?.(part) ?? <details className="inline-block"><summary className="text-xs text-muted-foreground">{part.tag}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{part.context}</pre></details>}</Fragment>;
    if (part.type === "file") return <Fragment key={part.part_id}>{render_file?.(part) ?? <a className="inline-flex items-center gap-1 text-xs" href={part.url} target="_blank" rel="noreferrer"><File className="size-3.5" />{part.filename || "File"}</a>}</Fragment>;
    return null;
  })}</div>;
}
/** 普通短文本可与相邻附件保持同一行。 */
function is_inline_text(text: string): boolean {
  return !/(?:^|\n)\s*(?:#{1,6}\s|[-+*]\s|\d+\.\s|>|```|~~~)|\n\s*\n/u.test(text);
}
