/** Downcity Desktop 的结构化 Chat Composer、附件、Slash 与发送控制器。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TbArrowDown, TbArrowUp, TbCornerDownRight, TbLoader2, TbPaperclip, TbPhoto, TbPlus, TbSquare, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { is_chat_busy, type QueuedChatMessage } from "@/types/DesktopView";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopChatInput, DesktopChatReferenceInput, DesktopChatRuntime, DesktopModelSummary, DesktopSessionConfiguration, DesktopSettings } from "@common/types/DesktopApi";
import { ChatApprovalModeSelector } from "./ChatApprovalModeSelector";
import { ChatModelSelector } from "./ChatModelSelector";
import { ChatAttachmentNode, ChatReferenceNode } from "./editor/ChatComposerNodes";
import { ChatSlashMenu } from "./editor/ChatSlashMenu";
import { decode_chat_composer, encode_chat_composer } from "./editor/chatComposerCodec";
import { add_chat_reference_listener } from "./editor/chatReferenceEvent";
import { resolve_chat_input_command } from "./chat_input_command";

/** ChatInput 属性。 */
interface ChatInputEditorProps {
  /** 当前 Session 的稳定组合键。 */ editor_key: string;
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 当前输入文本。 */ draft: string;
  /** 当前附件草稿。 */ draft_files: DesktopChatFileInput[];
  /** 当前引用草稿。 */ draft_references: DesktopChatReferenceInput[];
  /** 当前 Session 运行态。 */ runtime?: DesktopChatRuntime;
  /** 当前输入队列。 */ queued_messages: QueuedChatMessage[];
  /** 当前 Session 模型和审批配置。 */ configuration?: DesktopSessionConfiguration;
  /** 可选 Federation 模型。 */ models: DesktopModelSummary[];
  /** 模型目录是否正在读取。 */ models_loading: boolean;
  /** Desktop 用户设置。 */ settings: DesktopSettings;
  /** 更新文本草稿。 */ update_draft(text: string): void;
  /** 更新附件草稿。 */ update_draft_files(files: DesktopChatFileInput[]): void;
  /** 更新引用草稿。 */ update_draft_references(references: DesktopChatReferenceInput[]): void;
  /** 提交完整输入。 */ send_message(input: DesktopChatInput): Promise<void>;
  /** 执行当前 Session 的显式压缩命令。 */ compact_session?(): Promise<void>;
  /** 停止当前 Turn。 */ stop_session(): Promise<void>;
  /** 刷新模型目录。 */ refresh_models(): Promise<void>;
  /** 切换模型。 */ set_model(model_id: string): Promise<void>;
  /** 切换推理强度。 */ set_reasoning_effort(reasoning_effort?: string): Promise<void>;
  /** 切换审批模式。 */ set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 删除队列消息。 */ remove_queued_message(message_id: string): void;
  /** 调整队列消息顺序。 */ move_queued_message(message_id: string, direction: "up" | "down"): void;
}

/** 编辑器当前可见的 Slash 查询。 */
interface SlashQuery {
  /** 查询文本，不含斜杠。 */ query: string;
  /** 斜杠起始文档位置。 */ from: number;
  /** 查询结束文档位置。 */ to: number;
}

/** 支持结构化草稿、多媒体节点、Slash 命令和消息引用的输入表面。 */
export function ChatInputEditor(props: ChatInputEditorProps) {
  const file_input_ref = useRef<HTMLInputElement>(null);
  const image_input_ref = useRef<HTMLInputElement>(null);
  const editor_ref = useRef<Editor | null>(null);
  const syncing_ref = useRef(false);
  const submitting_ref = useRef(false);
  const slash_query_ref = useRef<SlashQuery | undefined>(undefined);
  const props_ref = useRef(props);
  props_ref.current = props;
  const [submitting, set_submitting] = useState(false);
  const [attachment_error, set_attachment_error] = useState("");
  const [slash_query, set_slash_query] = useState<SlashQuery>();
  slash_query_ref.current = slash_query;
  const busy = is_chat_busy(props.runtime);

  const sync_controlled_draft = useCallback((current_editor: Editor) => {
    if (syncing_ref.current) return;
    const input = decode_chat_composer(current_editor.getJSON());
    props_ref.current.update_draft(input.text);
    props_ref.current.update_draft_files(input.files);
    props_ref.current.update_draft_references(input.references);
  }, []);

  const update_slash_query = useCallback((current_editor: Editor) => {
    const { $from } = current_editor.state.selection;
    if (!$from.parent.isTextblock) return set_slash_query(undefined);
    const before_cursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
    const match = before_cursor.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match) return set_slash_query(undefined);
    const query = match[1] ?? "";
    set_slash_query({ query, from: $from.pos - query.length - 1, to: $from.pos });
  }, []);

  async function insert_files(files: ArrayLike<File>) {
    const selected_files = Array.from(files);
    const too_large = selected_files.find((file) => file.size > 20 * 1024 * 1024);
    if (too_large) return set_attachment_error(`${too_large.name} 超过 20 MB`);
    set_attachment_error("");
    try {
      const nodes = await Promise.all(selected_files.map(async (file) => ({ type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), filename: file.name, media_type: file.type || "application/octet-stream", data_url: await read_file_as_data_url(file) } })));
      editor_ref.current?.chain().focus().insertContent(nodes).run();
    } catch (reason) {
      set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const run_compact_command = useCallback(async (restore_command_on_failure: boolean) => {
    const current_editor = editor_ref.current;
    if (!current_editor || submitting_ref.current || !props_ref.current.compact_session) return;
    set_submitting(true);
    submitting_ref.current = true;
    try {
      await props_ref.current.compact_session();
      current_editor.commands.clearContent();
      current_editor.commands.focus();
    } catch {
      const current_input = decode_chat_composer(current_editor.getJSON());
      if (restore_command_on_failure && !current_input.text.trim() && current_input.files.length === 0 && current_input.references.length === 0) {
        current_editor.chain().focus().insertContent("/compact").run();
      }
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, []);

  const submit_message = useCallback(async () => {
    const current_editor = editor_ref.current;
    if (!current_editor || submitting_ref.current) return;
    const input = decode_chat_composer(current_editor.getJSON());
    if (!input.text.trim() && input.files.length === 0 && input.references.length === 0) return;
    const command = resolve_chat_input_command(input);
    if (command === "compact") {
      if (!props_ref.current.compact_session) return;
      await run_compact_command(false);
      return;
    }
    set_submitting(true);
    submitting_ref.current = true;
    try {
      await props_ref.current.send_message(input);
      current_editor.commands.focus();
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, [run_compact_command, submitting]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }), Placeholder.configure({ placeholder: "输入消息，使用 / 打开命令…" }), ChatAttachmentNode, ChatReferenceNode],
    content: encode_chat_composer(props.draft, props.draft_files, props.draft_references),
    editorProps: {
      attributes: { class: "chat-input-editor", "data-chat-input": "true", spellcheck: String(props.settings.spellcheck_enabled) },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.key !== "Enter" || slash_query_ref.current) return false;
        if (is_chat_busy(props_ref.current.runtime) && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit_message();
          return true;
        }
        const shortcut = props_ref.current.settings.send_message_on_enter ? !event.shiftKey && !event.metaKey && !event.ctrlKey : event.metaKey || event.ctrlKey;
        if (!shortcut) return false;
        event.preventDefault();
        void submit_message();
        return true;
      },
    },
    onCreate: ({ editor: current_editor }) => { editor_ref.current = current_editor; },
    onUpdate: ({ editor: current_editor }) => { sync_controlled_draft(current_editor); update_slash_query(current_editor); },
    onSelectionUpdate: ({ editor: current_editor }) => update_slash_query(current_editor),
    onDestroy: () => { editor_ref.current = null; },
  }, []);

  const current_input = editor ? decode_chat_composer(editor.getJSON()) : { text: props.draft, files: props.draft_files, references: props.draft_references };
  const input_empty = !current_input.text.trim() && current_input.files.length === 0 && current_input.references.length === 0;
  const show_stop = busy && input_empty && !submitting;

  useEffect(() => {
    if (!editor) return;
    const current = decode_chat_composer(editor.getJSON());
    if (current.text === props.draft && JSON.stringify(current.files) === JSON.stringify(props.draft_files) && JSON.stringify(current.references) === JSON.stringify(props.draft_references)) return;
    syncing_ref.current = true;
    editor.commands.setContent(encode_chat_composer(props.draft, props.draft_files, props.draft_references));
    syncing_ref.current = false;
    set_slash_query(undefined);
  }, [editor, props.draft, props.draft_files, props.draft_references, props.editor_key]);

  useEffect(() => add_chat_reference_listener((reference) => {
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.chain().focus("end").insertContent({ type: "chatReference", attrs: { ...reference, preview_text: reference.text.replace(/\s+/g, " ").trim().slice(0, 80) } }).run();
  }), []);

  const slash_commands = useMemo(() => {
    const commands: ChatSlashCommand[] = [
      { command_id: "attach", title: "/attach", description: "添加文件附件", keywords: ["file", "附件"], run: () => file_input_ref.current?.click() },
      { command_id: "image", title: "/image", description: "添加图片", keywords: ["photo", "图片"], run: () => image_input_ref.current?.click() },
      { command_id: "clear", title: "/clear", description: "清空当前输入", keywords: ["reset", "清空"], run: () => { editor_ref.current?.commands.clearContent(); } },
      ...(props.compact_session ? [{ command_id: "compact", title: "/compact", description: "压缩当前对话上下文", keywords: ["compact", "压缩", "context"], run: () => run_compact_command(true) }] : []),
      ...props.models.map((model) => ({ command_id: `model:${model.model_id}`, title: `/model ${model.name}`, description: `切换到 ${model.model_id}`, keywords: ["model", "模型", model.model_id], run: () => props.set_model(model.model_id) })),
      ...(["ask", "always-allow"] as const).map((mode) => ({ command_id: `approval:${mode}`, title: `/approval ${mode}`, description: mode === "ask" ? "执行前询问" : "自动允许", keywords: ["approval", "权限"], run: () => props.set_approval_mode(mode) })),
    ];
    const query = slash_query?.query.toLowerCase() ?? "";
    return commands.filter((command) => !query || `${command.title} ${command.keywords.join(" ")}`.toLowerCase().includes(query)).slice(0, 8);
  }, [props.compact_session, props.models, props.set_approval_mode, props.set_model, run_compact_command, slash_query?.query]);

  const select_slash_command = useCallback((command: ChatSlashCommand) => {
    const current_editor = editor_ref.current;
    if (!current_editor || !slash_query) return;
    current_editor.chain().focus().deleteRange({ from: slash_query.from, to: slash_query.to }).run();
    set_slash_query(undefined);
    void command.run();
  }, [slash_query]);

  return <div className="relative flex w-full min-w-0 flex-none flex-col gap-2 p-1">
    <input ref={file_input_ref} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    <input ref={image_input_ref} type="file" multiple hidden accept="image/*" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    {props.queued_messages.length > 0 ? <QueuedMessageList {...props} /> : null}
    {attachment_error ? <div className="px-2 text-[11px] text-destructive">{attachment_error}</div> : null}
    {slash_query ? <ChatSlashMenu commands={slash_commands} select_command={select_slash_command} /> : null}
    <div className="min-h-20 max-h-60 w-full overflow-hidden p-1">
      <EditorContent editor={editor} />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="rounded-full" aria-label="添加内容" title="添加内容" disabled={submitting}><TbPlus className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent side="top" sideOffset={4}><DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>附件</span></DropdownMenuItem><DropdownMenuItem onClick={() => image_input_ref.current?.click()}><TbPhoto className="size-4" /><span>图片</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu><ChatModelSelector agent={props.agent} configuration={props.configuration} models={props.models} models_loading={props.models_loading} set_model={props.set_model} set_reasoning_effort={props.set_reasoning_effort} /><ChatApprovalModeSelector configuration={props.configuration} set_approval_mode={props.set_approval_mode} /></div>
        <Button type="button" onClick={() => void (show_stop ? props.stop_session() : submit_message())} disabled={submitting || (!show_stop && input_empty)} size="icon" variant="primary" className="rounded-full" aria-label={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"} title={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"}>{show_stop ? <TbSquare className="size-4 stroke-3" /> : submitting ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>
      </div>
    </div>
  </div>;
}

/** 输入框上方的待发送队列。 */
function QueuedMessageList(props: Pick<ChatInputEditorProps, "queued_messages" | "remove_queued_message" | "move_queued_message">) {
  return <div className="chat-queued-message-list max-h-28 overflow-y-auto"><div className="flex flex-col divide-y divide-border/30">{props.queued_messages.map((message, index) => <div key={message.message_id} className="flex min-h-7 items-center gap-0.5 px-2.5 py-1 text-[0.6875rem] text-muted-foreground">{message.sending ? <TbLoader2 className="size-3 animate-spin" /> : <TbCornerDownRight className="size-3" />}<span className="min-w-0 flex-1 truncate px-1">{message.input.text || `${message.input.files.length + (message.input.references?.length ?? 0)} 个内容`}</span><Button className="size-5 [&_svg]:size-3" title="上移" disabled={index === 0 || message.sending} onClick={() => props.move_queued_message(message.message_id, "up")}><TbArrowUp /></Button><Button className="size-5 [&_svg]:size-3" title="下移" disabled={index === props.queued_messages.length - 1 || message.sending} onClick={() => props.move_queued_message(message.message_id, "down")}><TbArrowDown /></Button><Button className="size-5 [&_svg]:size-3" title="移除" disabled={message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /></Button></div>)}</div></div>;
}

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`)); reader.readAsDataURL(file); });
}
