/** 一条 canonical User Message 的展示、编辑与历史操作边界。 */

import { useMemo, useState } from "react";
import type { SessionUserMessage } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import { TbGitBranch, TbLoader2, TbPencil, TbRoute } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { UserMessageContent } from "@/features/chat/components/UserMessageContent";
import { UserMessageFrame } from "@/features/chat/components/messages/UserMessageFrame";
import { UserMessageRewriteEditor } from "@/features/chat/components/UserMessageRewriteEditor";
import { MessageActionButton } from "@/features/chat/components/messages/MessageActionButton";
import { create_chat_composer_from_user_parts } from "@/features/chat/composer/editor/chatSessionMessageCodec";
import { resolve_user_message_rewrite } from "@/features/chat/lib/user_message_rewrite";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopChatRewriteAction, DesktopChatRewriteInput } from "@common/types/DesktopApi";

/** User Message 拥有自己的编辑草稿、Rewrite 决策和 Fork 提交状态。 */
export function UserMessage({ message, fork_message, rewrite_message, has_later_visible_message, can_use_history_actions, can_replace_session }: { /** canonical User Message。 */ message: SessionUserMessage; /** 创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 重写历史用户消息。 */ rewrite_message?(input: DesktopChatRewriteInput): Promise<void>; /** 当前消息之后是否仍有可见内容。 */ has_later_visible_message: boolean; /** 当前是否允许历史操作。 */ can_use_history_actions: boolean; /** 当前 Session 是否允许被替换。 */ can_replace_session: boolean }) {
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
  const start_editing = () => { set_pending_document(null); set_rewrite_error(""); set_editing(true); };
  const cancel_editing = () => { set_pending_document(null); set_rewrite_error(""); set_editing(false); };
  const submit_rewrite = async (action: DesktopChatRewriteAction, document = pending_document) => {
    if (!document || !rewrite_message || submitting) return;
    if (action === "replace" && !can_replace_session) { set_rewrite_error(translate_chat("message.replace_blocked_queue")); return; }
    set_choice_open(false);
    set_rewrite_error("");
    set_submitting(true);
    try { await rewrite_message({ message_id: message.message_id, document, action }); set_editing(false); }
    catch (reason) { set_rewrite_error(reason instanceof Error ? reason.message : translate_chat("message.send_failed")); }
    finally { set_submitting(false); }
  };
  const confirm_editing = (document: JSONContent) => {
    set_pending_document(document);
    set_rewrite_error("");
    if (resolve_user_message_rewrite(has_later_visible_message, can_replace_session) === "replace") void submit_rewrite("replace", document);
    else set_choice_open(true);
  };
  // 用户消息的右对齐气泡、元信息行位置与宽度约束全在 UserMessageFrame 里，
  // 与 Group 共享消息的用户发言共用同一份几何；这里只提供本表面特有的内容与操作。
  //
  // 重写选择框是消息【之外】的一层（它不参与消息几何），因此与 Frame 平行，不放进气泡。
  return <>
    <UserMessageFrame
      editing={editing}
      meta={!editing ? <>
        <ChatMessageTimestamp created_at={message.created_at} class_name="mr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" />
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {message.parts.length > 0 && rewrite_message ? <MessageActionButton title={translate_chat("message.edit")} disabled={!can_use_history_actions} on_click={start_editing}><TbPencil /></MessageActionButton> : null}
          <MessageActionButton title={translate_chat("message.fork")} disabled={forking || !can_use_history_actions} on_click={() => void fork()}>{forking ? <TbLoader2 className="animate-spin" /> : <TbGitBranch />}</MessageActionButton>
        </span>
      </> : null}
    >
      {editing
        ? <UserMessageRewriteEditor initial_document={initial_document} submitting={submitting} error={rewrite_error} cancel={cancel_editing} submit={confirm_editing} />
        : <UserMessageContent message_id={message.message_id} parts={message.parts} />}
    </UserMessageFrame>
    <Dialog open={choice_open} onOpenChange={set_choice_open}><DialogContent size="sm"><DialogHeader><div><DialogTitle>{translate_chat("message.rewrite_title")}</DialogTitle><DialogDescription>{translate_chat("message.rewrite_description")}</DialogDescription></div></DialogHeader><DialogBody className="gap-2">
      <button type="button" disabled={submitting} onClick={() => void submit_rewrite("fork")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left outline-none hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30"><TbGitBranch className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">{translate_chat("message.fork_title")}</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">{translate_chat("message.fork_description")}</span></span></button>
      <button type="button" disabled={submitting || !can_replace_session} onClick={() => void submit_rewrite("replace")} className="flex w-full items-start gap-3 rounded-md border border-border-subtle px-3 py-3 text-left outline-none enabled:hover:bg-interaction-hover disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/30"><TbRoute className="mt-0.5 size-4 shrink-0" /><span><span className="block text-xs font-medium">{translate_chat("message.replace_title")}</span><span className="mt-0.5 block text-[0.6875rem] leading-4 text-muted-foreground">{translate_chat(can_replace_session ? "message.replace_description" : "message.replace_blocked_queue")}</span></span></button>
    </DialogBody><DialogFooter><Button disabled={submitting} onClick={() => set_choice_open(false)}>{translate_common("actions.cancel")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
