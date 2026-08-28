/** Downcity Desktop 的结构化 Chat Composer、附件、Slash 与发送控制器。 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TbArrowDown, TbArrowUp, TbChevronDown, TbCornerDownRight, TbLoader2, TbPaperclip, TbPhoto, TbPlus, TbSquare, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { is_chat_busy, type QueuedChatMessage } from "@/types/DesktopView";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import type { DesktopAgentSummary, DesktopChatFileInput, DesktopChatInput, DesktopChatReferenceInput, DesktopChatRuntime, DesktopGroupStatusPhase, DesktopModelSummary, DesktopSessionConfiguration, DesktopSettings } from "@common/types/DesktopApi";
import { ChatApprovalModeSelector } from "./ChatApprovalModeSelector";
import { ChatModelSelector } from "./ChatModelSelector";
import { ChatAttachmentNode, ChatReferenceNode } from "./editor/ChatComposerNodes";
import { ChatSlashMenu } from "./editor/ChatSlashMenu";
import { decode_chat_composer, encode_chat_composer } from "./editor/chatComposerCodec";
import { add_chat_reference_listener } from "./editor/chatReferenceEvent";
import { resolve_chat_input_command } from "./chat_input_command";

/** ChatInput 属性。 */
interface ChatInputEditorProps {
  /** 是否用于 Group 群聊；群聊保留纯文本发送，并支持成员 @ 提及。 */
  group_mode?: boolean;
  /** Group 群聊可被 @ 提及的成员。 */
  group_members?: DesktopAgentSummary[];
  /** 当前 Chat 的 UI 表面；仅影响空状态和输入提示。 */
  surface?: "agent" | "workspace";
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** 当前 Session 的稳定组合键。 */ editor_key: string;
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 当前输入文本。 */ draft: string;
  /** 当前附件草稿。 */ draft_files: DesktopChatFileInput[];
  /** 当前引用草稿。 */ draft_references: DesktopChatReferenceInput[];
  /** 当前 Session 运行态。 */ runtime?: DesktopChatRuntime;
  /** Group 当前运行阶段；仅群聊输入使用。 */ group_phase?: DesktopGroupStatusPhase;
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

/** 编辑器当前可见的 Workspace 文件查询。 */
interface FileQuery { query: string; from: number; to: number; }
/** Group 成员 @ 查询在编辑器中的范围。 */
interface MemberQuery { query: string; from: number; to: number; }

const composer_height_storage_key = "downcity.chat_composer_height";
const default_composer_height = 220;
const min_composer_height = 160;

/** 支持结构化草稿、多媒体节点、Slash 命令和消息引用的输入表面。 */
export function ChatInputEditor(props: ChatInputEditorProps) {
  const file_input_ref = useRef<HTMLInputElement>(null);
  const image_input_ref = useRef<HTMLInputElement>(null);
  const editor_ref = useRef<Editor | null>(null);
  const syncing_ref = useRef(false);
  const submitting_ref = useRef(false);
  const slash_query_ref = useRef<SlashQuery | undefined>(undefined);
  const file_query_ref = useRef<FileQuery | undefined>(undefined);
  const member_query_ref = useRef<MemberQuery | undefined>(undefined);
  const member_candidates_ref = useRef<DesktopAgentSummary[]>([]);
  const props_ref = useRef(props);
  props_ref.current = props;
  const [submitting, set_submitting] = useState(false);
  const [attachment_error, set_attachment_error] = useState("");
  const [slash_query, set_slash_query] = useState<SlashQuery>();
  const [file_query, set_file_query] = useState<FileQuery>();
  const [member_query, set_member_query] = useState<MemberQuery>();
  const [workspace_files, set_workspace_files] = useState<import("@common/types/DesktopApi").DesktopWorkspaceFile[]>([]);
  const [queue_expanded, set_queue_expanded] = useState(false);
  const [composer_height, set_composer_height] = useState(() => normalize_composer_height(Number(localStorage.getItem(composer_height_storage_key)) || default_composer_height));
  slash_query_ref.current = slash_query;
  file_query_ref.current = file_query;
  member_query_ref.current = member_query;
  const busy = props.group_mode
    ? props.group_phase === "dispatching" || props.group_phase === "dispatched" || props.group_phase === "executing"
    : is_chat_busy(props.runtime);

  const handle_resize_start = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start_y = event.clientY;
    const start_height = composer_height;
    const handle_mouse_move = (move_event: MouseEvent) => {
      set_composer_height(normalize_composer_height(start_height + start_y - move_event.clientY));
    };
    const handle_mouse_up = (up_event: MouseEvent) => {
      const next_height = normalize_composer_height(start_height + start_y - up_event.clientY);
      set_composer_height(next_height);
      localStorage.setItem(composer_height_storage_key, String(next_height));
      document.removeEventListener("mousemove", handle_mouse_move);
      document.removeEventListener("mouseup", handle_mouse_up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handle_mouse_move);
    document.addEventListener("mouseup", handle_mouse_up);
  }, [composer_height]);

  const reset_composer_height = useCallback(() => {
    set_composer_height(default_composer_height);
    localStorage.setItem(composer_height_storage_key, String(default_composer_height));
  }, []);

  const sync_controlled_draft = useCallback((current_editor: Editor) => {
    if (syncing_ref.current) return;
    const input = decode_chat_composer(current_editor.getJSON());
    props_ref.current.update_draft(input.text);
    props_ref.current.update_draft_files(input.files);
    props_ref.current.update_draft_references(input.references);
  }, []);

  const update_slash_query = useCallback((current_editor: Editor) => {
    if (props_ref.current.group_mode) { set_slash_query(undefined); return; }
    const { $from } = current_editor.state.selection;
    if (!$from.parent.isTextblock) { set_slash_query(undefined); set_file_query(undefined); return; }
    const before_cursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
    const match = before_cursor.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match) { set_slash_query(undefined); return; }
    set_file_query(undefined);
    const query = match[1] ?? "";
    set_slash_query({ query, from: $from.pos - query.length - 1, to: $from.pos });
  }, []);

  const update_file_query = useCallback((current_editor: Editor) => {
    if (props_ref.current.group_mode) { set_file_query(undefined); return; }
    const { $from } = current_editor.state.selection;
    if (!$from.parent.isTextblock) return set_file_query(undefined);
    const before_cursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
    const match = before_cursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return set_file_query(undefined);
    set_slash_query(undefined);
    const query = match[1] ?? "";
    set_file_query({ query, from: $from.pos - query.length - 1, to: $from.pos });
  }, []);

  const update_member_query = useCallback((current_editor: Editor) => {
    if (!props_ref.current.group_mode) { set_member_query(undefined); return; }
    const { $from } = current_editor.state.selection;
    if (!$from.parent.isTextblock) return set_member_query(undefined);
    const before_cursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
    const match = before_cursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return set_member_query(undefined);
    set_member_query({ query: match[1] ?? "", from: $from.pos - (match[1]?.length ?? 0) - 1, to: $from.pos });
  }, []);

  const select_group_member = useCallback((member: DesktopAgentSummary) => {
    const current_editor = editor_ref.current;
    const query = member_query_ref.current;
    if (!current_editor || !query) return;
    current_editor.chain().focus().deleteRange({ from: query.from, to: query.to }).insertContent(`@${member.agent_id} `).run();
    set_member_query(undefined);
  }, []);

  useEffect(() => {
    if (props.group_mode) {
      set_workspace_files([]);
      set_file_query(undefined);
      return;
    }
    let disposed = false;
    void window.downcity.chat.list_workspace_files(props.workspace_id).then((files) => { if (!disposed) set_workspace_files(files); }).catch(() => { if (!disposed) set_workspace_files([]); });
    return () => { disposed = true; };
  }, [props.group_mode, props.workspace_id, props.surface]);

  async function insert_files(files: ArrayLike<File>) {
    if (props_ref.current.group_mode) return;
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
    const submitted_input: DesktopChatInput = props_ref.current.group_mode
      ? { text: input.text, files: [], references: [] }
      : input;
    if (!submitted_input.text.trim() && submitted_input.files.length === 0 && submitted_input.references.length === 0) return;
    // 群聊没有 Agent 专属本地命令；斜杠文本应作为普通群聊消息交给调度器。
    const command = props_ref.current.group_mode ? undefined : resolve_chat_input_command(submitted_input);
    if (command === "compact") {
      if (!props_ref.current.compact_session) return;
      await run_compact_command(false);
      return;
    }
    set_submitting(true);
    submitting_ref.current = true;
    try {
      await props_ref.current.send_message(submitted_input);
      current_editor.commands.focus();
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, [run_compact_command]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }), Placeholder.configure({ placeholder: props.group_mode ? "输入消息，发送给 Group…" : props.surface === "agent" ? "和 Agent 继续对话…" : "输入消息，使用 / 打开命令…" }), ChatAttachmentNode, ChatReferenceNode],
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
        if (event.isComposing || event.key !== "Enter") return false;
        if (props_ref.current.group_mode && member_query_ref.current && member_candidates_ref.current[0]) {
          event.preventDefault();
          select_group_member(member_candidates_ref.current[0]);
          return true;
        }
        if (!props_ref.current.group_mode && file_query_ref.current && file_candidates[0]) {
          event.preventDefault();
          void select_workspace_file(file_candidates[0]);
          return true;
        }
        if (slash_query_ref.current) return false;
        const current_busy = props_ref.current.group_mode
          ? props_ref.current.group_phase === "dispatching" || props_ref.current.group_phase === "dispatched" || props_ref.current.group_phase === "executing"
          : is_chat_busy(props_ref.current.runtime);
        if (current_busy && event.shiftKey && (event.metaKey || event.ctrlKey)) {
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
    onUpdate: ({ editor: current_editor }) => { sync_controlled_draft(current_editor); update_slash_query(current_editor); update_file_query(current_editor); update_member_query(current_editor); },
    onSelectionUpdate: ({ editor: current_editor }) => { update_slash_query(current_editor); update_file_query(current_editor); update_member_query(current_editor); },
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
    set_file_query(undefined);
    set_member_query(undefined);
  }, [editor, props.draft, props.draft_files, props.draft_references, props.editor_key]);

  useEffect(() => add_chat_reference_listener((reference) => {
    if (props_ref.current.group_mode) return;
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

  const file_candidates = useMemo(() => {
    const query = file_query?.query.toLowerCase() ?? "";
    return workspace_files.filter((file) => !query || file.relative_path.toLowerCase().includes(query)).slice(0, 8);
  }, [file_query?.query, workspace_files]);

  const member_candidates = useMemo(() => {
    const query = member_query?.query.toLowerCase() ?? "";
    return (props.group_members ?? []).filter((member) => !query || member.agent_id.toLowerCase().includes(query)).slice(0, 8);
  }, [member_query?.query, props.group_members]);
  member_candidates_ref.current = member_candidates;

  const select_workspace_file = useCallback(async (file: import("@common/types/DesktopApi").DesktopWorkspaceFile) => {
    if (props_ref.current.group_mode) return;
    const current_editor = editor_ref.current;
    if (!current_editor || !file_query) return;
    current_editor.chain().focus().deleteRange({ from: file_query.from, to: file_query.to }).run();
    set_file_query(undefined);
    try {
      const attachment = await window.downcity.chat.read_workspace_file(props.workspace_id, file.relative_path);
      current_editor.chain().focus().insertContent({ type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), ...attachment } }).run();
    } catch (reason) {
      set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  }, [file_query, props.workspace_id]);

  const select_slash_command = useCallback((command: ChatSlashCommand) => {
    const current_editor = editor_ref.current;
    if (!current_editor || !slash_query) return;
    current_editor.chain().focus().deleteRange({ from: slash_query.from, to: slash_query.to }).run();
    set_slash_query(undefined);
    void command.run();
  }, [slash_query]);

  return (<div className="chat-composer relative flex w-full min-w-0 flex-none flex-col" style={{ height: composer_height }}>
    <div className="chat-composer-resize-handle absolute inset-x-0 top-0 z-20 h-2 cursor-ns-resize" role="separator" aria-label="调整输入区高度" aria-orientation="horizontal" onMouseDown={handle_resize_start} onDoubleClick={reset_composer_height}><span /></div>
    <input ref={file_input_ref} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    <input ref={image_input_ref} type="file" multiple hidden accept="image/*" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    {!props.group_mode ? <div className="chat-composer-toolbar relative flex min-h-10 items-center justify-between gap-2 px-2 pt-2">
      <div className="flex min-w-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" className="rounded-full" aria-label="添加内容" title="添加内容" disabled={submitting}><TbPlus className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent side="top" sideOffset={4}>
            <DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>附件</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => image_input_ref.current?.click()}><TbPhoto className="size-4" /><span>图片</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChatModelSelector agent={props.agent} configuration={props.configuration} models={props.models} models_loading={props.models_loading} set_model={props.set_model} set_reasoning_effort={props.set_reasoning_effort} />
        <ChatApprovalModeSelector configuration={props.configuration} set_approval_mode={props.set_approval_mode} />
      </div>
    </div> : <div className="min-h-2" />}
    {!props.group_mode && props.queued_messages.length > 0 ? <QueuedMessageList {...props} expanded={queue_expanded} toggle_expanded={() => set_queue_expanded((value) => !value)} /> : null}
    {attachment_error ? <div className="px-3 pb-1 text-[11px] text-destructive">{attachment_error}</div> : null}
    {member_query && member_candidates.length > 0 ? <div className="absolute bottom-full left-1 z-30 mb-2 w-56 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none">{member_candidates.map((member) => <button key={member.agent_id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]" onMouseDown={(event) => event.preventDefault()} onClick={() => select_group_member(member)}><AgentAvatar agent={member} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">@{member.agent_id}</span></button>)}</div> : slash_query ? <ChatSlashMenu commands={slash_commands} select_command={select_slash_command} /> : file_query && file_candidates.length > 0 ? <div className="absolute bottom-full left-1 z-30 mb-2 w-72 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none">{file_candidates.map((file) => <button key={file.relative_path} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]" onMouseDown={(event) => event.preventDefault()} onClick={() => void select_workspace_file(file)}><TbPaperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.relative_path}</span></button>)}</div> : null}
    <div className="chat-composer-editor min-h-0 w-full flex-1 overflow-y-auto px-3 py-2">
    <EditorContent editor={editor} className="chat-composer-content h-full" />
    </div>
    <div className="flex min-h-10 items-center justify-end gap-2 px-2 pb-2">
      <Button type="button" onClick={() => void (show_stop ? props.stop_session() : submit_message())} disabled={submitting || (!show_stop && input_empty)} size="icon" variant="primary" className="rounded-full" aria-label={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"} title={show_stop ? "停止生成" : busy ? "加入队列" : "发送消息"}>{show_stop ? <TbSquare className="size-4 stroke-3" /> : submitting ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>
    </div>
  </div>);
}

/** 将输入区高度约束在当前窗口可用范围内。 */
function normalize_composer_height(height: number): number {
  const max_composer_height = Math.max(min_composer_height, Math.min(560, Math.floor(window.innerHeight * 0.6)));
  return Math.round(Math.min(max_composer_height, Math.max(min_composer_height, height)));
}

/** 输入框上方的待发送队列。 */
function QueuedMessageList(props: Pick<ChatInputEditorProps, "queued_messages" | "remove_queued_message" | "move_queued_message"> & { expanded: boolean; toggle_expanded(): void }) {
  return <div className="chat-queued-message-list"><button type="button" className="flex min-h-8 w-full items-center gap-1.5 px-3 text-left text-[0.6875rem] text-muted-foreground hover:text-foreground" onClick={props.toggle_expanded}><TbChevronDown className={props.expanded ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} /><span className="flex-1">待发送 {props.queued_messages.length} 条</span><span className="text-[10px]">点击展开</span></button>{props.expanded ? <div className="max-h-28 overflow-y-auto"><div className="flex flex-col">{props.queued_messages.map((message, index) => <div key={message.message_id} className="flex min-h-7 items-center gap-0.5 px-2.5 py-1 text-[0.6875rem] text-muted-foreground">{message.sending ? <TbLoader2 className="size-3 animate-spin" /> : <TbCornerDownRight className="size-3" />}<span className="min-w-0 flex-1 truncate px-1">{message.input.text || `${message.input.files.length + (message.input.references?.length ?? 0)} 个内容`}</span><Button className="size-5 [&_svg]:size-3" title="上移" disabled={index === 0 || message.sending} onClick={() => props.move_queued_message(message.message_id, "up")}><TbArrowUp /></Button><Button className="size-5 [&_svg]:size-3" title="下移" disabled={index === props.queued_messages.length - 1 || message.sending} onClick={() => props.move_queued_message(message.message_id, "down")}><TbArrowDown /></Button><Button className="size-5 [&_svg]:size-3" title="移除" disabled={message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /></Button></div>)}</div></div> : null}</div>;
}

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`)); reader.readAsDataURL(file); });
}
