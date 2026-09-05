/** Downcity Desktop 的结构化 Chat Composer、附件、Slash 与发送控制器。 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TbArrowDown, TbArrowUp, TbCheck, TbCornerDownRight, TbLoader2, TbPaperclip, TbPencil, TbPhoto, TbPlayerPause, TbPlayerPlay, TbPlus, TbSquare, TbTrash, TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { is_chat_busy, type ChatSubmitMode, type QueuedChatMessage } from "@/types/DesktopView";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import type { DesktopAgentSummary, DesktopChatRuntime, DesktopGroupSessionSummary, DesktopGroupStatusPhase, DesktopModelSummary, DesktopSessionConfiguration, DesktopSettings } from "@common/types/DesktopApi";
import { ChatApprovalModeSelector } from "@/features/chat/composer/ChatApprovalModeSelector";
import { ChatModelSelector } from "@/features/chat/composer/ChatModelSelector";
import { ChatAttachmentNode, ChatReferenceNode } from "@/features/chat/composer/editor/ChatComposerNodes";
import { ChatSlashMenu } from "@/features/chat/composer/editor/ChatSlashMenu";
import { count_chat_composer_atoms, has_chat_composer_atoms, is_chat_composer_empty, read_chat_composer_text, resolve_chat_input_command } from "@/features/chat/composer/editor/chatComposerCodec";
import { add_chat_reference_listener } from "@/features/chat/composer/editor/chatReferenceEvent";
import { add_chat_mention_listener } from "@/features/chat/composer/editor/chatMentionEvent";


import type { MessageQueueProps } from "@/types/ChatComponents";
import { use_translation } from "@/locales/i18n";
/** 输入框上方的待发送队列。 */
export function MessageQueue(props: MessageQueueProps) {
  const translate = use_translation("chat");
  const [editing, set_editing] = useState<{ message_id: string; text: string }>();
  const save_editing = () => {
    if (!editing?.text.trim()) return;
    props.update_queued_message(editing.message_id, editing.text);
    set_editing(undefined);
  };
  const action_class = "size-5 rounded-sm text-muted-foreground/70 [&_svg]:size-3";
  return <div className="chat-queued-message-list max-h-32 overflow-y-auto">
    <div className="flex min-h-6 items-center justify-end px-2">
      <Button className="h-5 gap-1 rounded-sm px-1 text-[0.625rem] text-muted-foreground/75 [&_svg]:size-3" title={translate(props.queue_paused ? "queue.resume_all" : "queue.pause_all")} onClick={() => props.set_queue_paused(!props.queue_paused)}>{props.queue_paused ? <TbPlayerPlay /> : <TbPlayerPause />}{translate(props.queue_paused ? "queue.resume" : "queue.pause")}</Button>
    </div>
    <div className="flex flex-col divide-y divide-border/30">{props.queued_messages.map((message, index) => {
      const is_editing = editing?.message_id === message.message_id;
      const text = read_chat_composer_text(message.input);
      const atom_count = count_chat_composer_atoms(message.input);
      const editable = !has_chat_composer_atoms(message.input);
      return <div key={message.message_id} className="flex min-h-7 items-center gap-0.5 px-2.5 py-1 text-[0.6875rem] text-muted-foreground">
        {message.sending ? <TbLoader2 className="size-3 shrink-0 animate-spin text-muted-foreground/65" /> : <TbCornerDownRight className="size-3 shrink-0 text-muted-foreground/45" />}
        {is_editing ? <><textarea autoFocus rows={1} value={editing.text} className="min-h-6 min-w-0 flex-1 resize-none rounded-sm border border-border/40 bg-background/50 px-1 py-0.5 text-[0.6875rem] text-foreground" onChange={(event) => set_editing({ message_id: message.message_id, text: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); save_editing(); } else if (event.key === "Escape") { event.preventDefault(); set_editing(undefined); } }} /><Button className={action_class} title={translate("queue.save")} onClick={save_editing}><TbCheck /></Button><Button className={action_class} title={translate("queue.cancel")} onClick={() => set_editing(undefined)}><TbX /></Button></> : <>
          <span className="min-w-0 flex-1 truncate px-1 py-0.5 text-foreground/70">{text || translate("queue.contents", { count: atom_count })}</span>
          {message.paused && !message.sending ? <span className="shrink-0 px-1 text-[0.625rem] text-muted-foreground/70">{translate("queue.paused")}</span> : null}
          <Button className={action_class} title={translate(editable ? "queue.edit" : "queue.edit_unavailable")} disabled={message.sending || !editable} onClick={() => set_editing({ message_id: message.message_id, text })}><TbPencil /></Button>
          <Button className={action_class} title={translate(message.paused ? "queue.resume_item" : "queue.pause_item")} disabled={message.sending} onClick={() => props.toggle_queued_message_paused(message.message_id)}>{message.paused ? <TbPlayerPlay /> : <TbPlayerPause />}</Button>
          <Button className={action_class} title={translate("queue.move_up")} disabled={index === 0 || message.sending} onClick={() => props.move_queued_message(message.message_id, "up")}><TbArrowUp /></Button>
          <Button className={action_class} title={translate("queue.move_down")} disabled={index === props.queued_messages.length - 1 || message.sending} onClick={() => props.move_queued_message(message.message_id, "down")}><TbArrowDown /></Button>
          <Button className={action_class} title={translate("queue.send_now")} disabled={message.sending} onClick={() => void props.send_queued_message(message.message_id)}><TbCornerDownRight /></Button>
          <Button className={action_class} title={translate("queue.delete")} disabled={message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /></Button>
        </>}
      </div>;
    })}</div>
  </div>;
}
