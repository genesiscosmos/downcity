/** Duobox 风格的 Desktop Chat 输入、附件、模型与审批控制器。 */

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  TbArrowDown,
  TbArrowUp,
  TbCornerDownRight,
  TbFile,
  TbLoader2,
  TbPaperclip,
  TbPlus,
  TbSquare,
  TbTrash,
} from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type {
  DesktopAgentSummary,
  DesktopChatFileInput,
  DesktopChatInput,
  DesktopChatRuntime,
  DesktopModelSummary,
  DesktopSessionConfiguration,
  DesktopSettings,
} from "@common/types/DesktopApi";
import { is_chat_busy, type QueuedChatMessage } from "@/types/DesktopView";
import { ChatApprovalModeSelector } from "./ChatApprovalModeSelector";
import { ChatModelSelector } from "./ChatModelSelector";

/** ChatInput 属性。 */
interface ChatInputEditorProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** 当前输入文本。 */
  draft: string;
  /** 当前附件草稿。 */
  draft_files: DesktopChatFileInput[];
  /** 当前 Session 运行态。 */
  runtime?: DesktopChatRuntime;
  /** 当前输入队列。 */
  queued_messages: QueuedChatMessage[];
  /** 当前 Session 模型和审批配置。 */
  configuration?: DesktopSessionConfiguration;
  /** 可选 Federation 模型。 */
  models: DesktopModelSummary[];
  /** 模型目录是否正在读取。 */
  models_loading: boolean;
  /** Desktop 用户设置。 */
  settings: DesktopSettings;
  /** 更新文本草稿。 */
  update_draft(text: string): void;
  /** 更新附件草稿。 */
  update_draft_files(files: DesktopChatFileInput[]): void;
  /** 提交完整输入。 */
  send_message(input: DesktopChatInput): Promise<void>;
  /** 停止当前 Turn。 */
  stop_session(): Promise<void>;
  /** 刷新模型目录。 */
  refresh_models(): Promise<void>;
  /** 切换模型。 */
  set_model(model_id: string): Promise<void>;
  /** 切换审批模式。 */
  set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 删除队列消息。 */
  remove_queued_message(message_id: string): void;
  /** 调整队列消息顺序。 */
  move_queued_message(message_id: string, direction: "up" | "down"): void;
}

/** 与 Duobox ChatInputEditor 对齐的输入表面。 */
export function ChatInputEditor(props: ChatInputEditorProps) {
  const file_input_ref = useRef<HTMLInputElement>(null);
  const textarea_ref = useRef<HTMLTextAreaElement>(null);
  const [submitting, set_submitting] = useState(false);
  const [attachment_error, set_attachment_error] = useState("");
  const busy = is_chat_busy(props.runtime);
  const input_empty = !props.draft.trim() && props.draft_files.length === 0;
  const show_stop = busy && input_empty && !submitting;

  useEffect(() => {
    const textarea = textarea_ref.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(200, Math.max(50, textarea.scrollHeight))}px`;
  }, [props.draft]);

  const submit_message = async () => {
    if (input_empty || submitting) return;
    set_submitting(true);
    try {
      await props.send_message({ text: props.draft, files: props.draft_files });
    } finally {
      set_submitting(false);
    }
  };

  const handle_key_down = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (busy && event.key === "Enter" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit_message();
      return;
    }
    const shortcut = props.settings.send_message_on_enter
      ? event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey
      : event.key === "Enter" && (event.metaKey || event.ctrlKey);
    if (!shortcut) return;
    event.preventDefault();
    void submit_message();
  };

  const read_files = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const too_large = files.find((file) => file.size > 20 * 1024 * 1024);
    if (too_large) {
      set_attachment_error(`${too_large.name} 超过 20 MB`);
      return;
    }
    set_attachment_error("");
    try {
      const next_files = await Promise.all(files.map(async (file): Promise<DesktopChatFileInput> => ({
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        data_url: await read_file_as_data_url(file),
      })));
      props.update_draft_files([...props.draft_files, ...next_files]);
      textarea_ref.current?.focus();
    } catch (reason) {
      set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <div className="flex w-full min-w-0 flex-none flex-col gap-2 p-1">
      <input ref={file_input_ref} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx" onChange={(event) => void read_files(event)} />
      {props.queued_messages.length > 0 ? <QueuedMessageList {...props} /> : null}
      {props.draft_files.length > 0 ? <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto px-1 pt-1">
        {props.draft_files.map((file, index) => <div key={`${file.filename}:${index}`} className="flex h-7 max-w-52 items-center gap-1.5 rounded-md bg-background/75 px-2 text-[11px] text-foreground/80 ring-1 ring-border/60">
          <TbFile className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.filename}</span>
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`移除 ${file.filename}`} onClick={() => props.update_draft_files(props.draft_files.filter((_, item_index) => item_index !== index))}><TbTrash className="size-3" /></button>
        </div>)}
      </div> : null}
      {attachment_error ? <div className="px-2 text-[11px] text-destructive">{attachment_error}</div> : null}
      <div className="min-h-20 max-h-60 w-full overflow-hidden p-1">
        <textarea
          ref={textarea_ref}
          className="chat-input-editor"
          data-chat-input="true"
          value={props.draft}
          rows={1}
          spellCheck={props.settings.spellcheck_enabled}
          placeholder={submitting ? "正在发送消息" : busy ? "要求后续变更" : "输入消息..."}
          onChange={(event) => props.update_draft(event.target.value)}
          onKeyDown={handle_key_down}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" className="rounded-full" aria-label="附件" title="附件" disabled={submitting}><TbPlus className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent side="top"><DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>附件</span></DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
            <ChatModelSelector agent={props.agent} configuration={props.configuration} models={props.models} models_loading={props.models_loading} set_model={props.set_model} />
            <ChatApprovalModeSelector configuration={props.configuration} set_approval_mode={props.set_approval_mode} />
          </div>
          <Button type="button" onClick={() => void (show_stop ? props.stop_session() : submit_message())} disabled={submitting || (!show_stop && input_empty)} size="icon" variant="primary" className="rounded-full" aria-label={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"} title={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"}>{show_stop ? <TbSquare className="size-4 stroke-3" /> : submitting ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>
        </div>
      </div>
  </div>;
}

/** 输入框上方的待发送队列。 */
function QueuedMessageList(props: Pick<ChatInputEditorProps, "queued_messages" | "remove_queued_message" | "move_queued_message">) {
  return <div className="chat-queued-message-list max-h-28 overflow-y-auto"><div className="flex flex-col divide-y divide-border/30">
    {props.queued_messages.map((message, index) => <div key={message.message_id} className="group/queued flex min-h-7 items-center gap-0.5 px-2.5 py-1 text-[0.6875rem] leading-4 text-muted-foreground">
      {message.sending ? <TbLoader2 className="size-3 shrink-0 animate-spin text-muted-foreground/65" /> : <TbCornerDownRight className="size-3 shrink-0 text-muted-foreground/45" />}
      <span className="min-w-0 flex-1 truncate px-1 py-0.5 text-foreground/70">{message.input.text || `${message.input.files.length} 个附件`}</span>
      <Button className="size-5 rounded-sm text-muted-foreground/70 [&_svg]:size-3" title="上移" disabled={index === 0 || message.sending} onClick={() => props.move_queued_message(message.message_id, "up")}><TbArrowUp /></Button>
      <Button className="size-5 rounded-sm text-muted-foreground/70 [&_svg]:size-3" title="下移" disabled={index === props.queued_messages.length - 1 || message.sending} onClick={() => props.move_queued_message(message.message_id, "down")}><TbArrowDown /></Button>
      <Button className="size-5 rounded-sm text-muted-foreground/70 [&_svg]:size-3" title="移除" disabled={message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /></Button>
    </div>)}
  </div></div>;
}

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
}
