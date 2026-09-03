/** Downcity Desktop 的结构化 Chat Composer、附件、Slash 与发送控制器。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ChatApprovalModeSelector } from "./ChatApprovalModeSelector";
import { ChatModelSelector } from "./ChatModelSelector";
import { ChatAttachmentNode, ChatReferenceNode } from "./editor/ChatComposerNodes";
import { ChatSlashMenu } from "./editor/ChatSlashMenu";
import { count_chat_composer_atoms, has_chat_composer_atoms, is_chat_composer_empty, read_chat_composer_text, resolve_chat_input_command } from "./editor/chatComposerCodec";
import { add_chat_reference_listener } from "./editor/chatReferenceEvent";

/** ChatInput 属性。 */
interface ChatInputEditorProps {
  /** 是否用于 Group 群聊；群聊保留纯文本发送，并支持成员 @ 提及。 */
  group_mode?: boolean;
  /** 是否用于不绑定 Workspace 的 Agent 客户端对话。 */
  client_mode?: boolean;
  /** 客户端对话当前是否正在执行。 */
  client_executing?: boolean;
  /** Group 群聊可被 @ 提及的成员。 */
  group_members?: DesktopAgentSummary[];
  /** Group 群聊可切换的 Session。 */
  group_sessions?: DesktopGroupSessionSummary[];
  /** 切换当前 Group Session。 */
  select_group_session?(session_id: string): Promise<void>;
  /** 当前 Chat 的 UI 表面；仅影响空状态和输入提示。 */
  surface?: "agent" | "workspace";
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** 当前 Session 的稳定组合键。 */ editor_key: string;
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 当前完整的 Tiptap 输入草稿。 */ draft_content: JSONContent;
  /** 当前 Session 运行态。 */ runtime?: DesktopChatRuntime;
  /** Group 当前运行阶段；仅群聊输入使用。 */ group_phase?: DesktopGroupStatusPhase;
  /** 当前输入队列。 */ queued_messages: QueuedChatMessage[];
  /** 当前队列是否整体暂停。 */ queue_paused: boolean;
  /** 当前 Session 模型和审批配置。 */ configuration?: DesktopSessionConfiguration;
  /** 可选 Federation 模型。 */ models: DesktopModelSummary[];
  /** 模型目录是否正在读取。 */ models_loading: boolean;
  /** Desktop 用户设置。 */ settings: DesktopSettings;
  /** 更新完整的 Tiptap 输入草稿。 */ update_draft(input: JSONContent): void;
  /** 按指定意图立即提交或加入下一轮队列。 */ send_message(input: JSONContent, mode?: ChatSubmitMode): Promise<void>;
  /** 执行当前 Session 的显式压缩命令。 */ compact_session?(): Promise<void>;
  /** 停止当前 Turn。 */ stop_session(): Promise<void>;
  /** 刷新模型目录。 */ refresh_models(): Promise<void>;
  /** 切换模型。 */ set_model(model_id: string): Promise<void>;
  /** 切换推理强度。 */ set_reasoning_effort(reasoning_effort?: string): Promise<void>;
  /** 切换审批模式。 */ set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
  /** 删除队列消息。 */ remove_queued_message(message_id: string): void;
  /** 立即发送队列消息；运行中时作为 steer。 */ send_queued_message(message_id: string): Promise<void>;
  /** 修改队列消息文本。 */ update_queued_message(message_id: string, text: string): void;
  /** 切换单条队列消息暂停状态。 */ toggle_queued_message_paused(message_id: string): void;
  /** 设置整个队列暂停状态。 */ set_queue_paused(paused: boolean): void;
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
  slash_query_ref.current = slash_query;
  file_query_ref.current = file_query;
  member_query_ref.current = member_query;
  const busy = props.group_mode
    ? props.group_phase === "dispatching" || props.group_phase === "dispatched" || props.group_phase === "executing"
    : props.client_mode
      ? props.client_executing === true
    : is_chat_busy(props.runtime);

  const sync_controlled_draft = useCallback((current_editor: Editor) => {
    if (syncing_ref.current) return;
    props_ref.current.update_draft(current_editor.getJSON());
  }, []);

  const update_slash_query = useCallback((current_editor: Editor) => {
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
    if (props_ref.current.group_mode || props_ref.current.client_mode) { set_file_query(undefined); return; }
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
    current_editor.chain().focus().deleteRange({ from: query.from, to: query.to }).insertContent(`@${member.name} `).run();
    set_member_query(undefined);
  }, []);

  useEffect(() => {
    if (props.group_mode || props.client_mode) {
      set_workspace_files([]);
      set_file_query(undefined);
      return;
    }
    let disposed = false;
    void window.downcity.chat.list_workspace_files(props.workspace_id).then((files) => { if (!disposed) set_workspace_files(files); }).catch(() => { if (!disposed) set_workspace_files([]); });
    return () => { disposed = true; };
  }, [props.group_mode, props.workspace_id, props.surface]);

  async function insert_files(files: ArrayLike<File>) {
    if (props_ref.current.group_mode || props_ref.current.client_mode) return;
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
      if (restore_command_on_failure && is_chat_composer_empty(current_editor.getJSON())) {
        current_editor.chain().focus().insertContent("/compact").run();
      }
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, []);

  const submit_message = useCallback(async (mode: ChatSubmitMode = "send") => {
    const current_editor = editor_ref.current;
    if (!current_editor || submitting_ref.current) return;
    const input = current_editor.getJSON();
    if (is_chat_composer_empty(input)) return;
    // 群聊没有 Agent 专属本地命令；斜杠文本应作为普通群聊消息交给调度器。
    const command = props_ref.current.group_mode || props_ref.current.client_mode ? undefined : resolve_chat_input_command(input);
    if (command === "compact") {
      if (!props_ref.current.compact_session) return;
      await run_compact_command(false);
      return;
    }
    set_submitting(true);
    submitting_ref.current = true;
    try {
      await props_ref.current.send_message(input, mode);
      current_editor.commands.focus();
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, [run_compact_command]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }), Placeholder.configure({ placeholder: props.group_mode ? "输入消息，发送给 Group…" : props.client_mode ? "和 Agent 继续对话…" : props.surface === "agent" ? "和 Agent 继续对话…" : "输入消息，使用 / 打开命令…" }), ChatAttachmentNode, ChatReferenceNode],
    content: props.draft_content,
      editorProps: {
      attributes: { class: "chat-input-editor", "data-chat-input": "true", spellcheck: String(props.settings.spellcheck_enabled) },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length || props_ref.current.client_mode) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length || props_ref.current.client_mode) return false;
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
        if (!props_ref.current.group_mode && !props_ref.current.client_mode && file_query_ref.current && file_candidates[0]) {
          event.preventDefault();
          void select_workspace_file(file_candidates[0]);
          return true;
        }
        if (slash_query_ref.current) return false;
        const current_busy = props_ref.current.group_mode
          ? props_ref.current.group_phase === "dispatching" || props_ref.current.group_phase === "dispatched" || props_ref.current.group_phase === "executing"
          : props_ref.current.client_mode
            ? props_ref.current.client_executing === true
          : is_chat_busy(props_ref.current.runtime);
        if (!props_ref.current.group_mode && !props_ref.current.client_mode && current_busy && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit_message("queue");
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

  const current_input = editor?.getJSON() ?? props.draft_content;
  const input_empty = is_chat_composer_empty(current_input);
  const show_stop = busy && input_empty && !submitting;

  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(props.draft_content)) return;
    syncing_ref.current = true;
    editor.commands.setContent(props.draft_content);
    syncing_ref.current = false;
    set_slash_query(undefined);
    set_file_query(undefined);
    set_member_query(undefined);
  }, [editor, props.draft_content, props.editor_key]);

  useEffect(() => add_chat_reference_listener((reference) => {
    if (props_ref.current.group_mode) return;
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.chain().focus("end").insertContent({ type: "chatReference", attrs: { ...reference, preview_text: reference.text.replace(/\s+/g, " ").trim().slice(0, 80) } }).run();
  }), []);

  const slash_commands = useMemo(() => {
    const commands: ChatSlashCommand[] = [
      ...(props.group_mode || props.client_mode ? [] : [
        { command_id: "attach", title: "/attach", description: "添加文件附件", keywords: ["file", "附件"], run: () => file_input_ref.current?.click() },
        { command_id: "image", title: "/image", description: "添加图片", keywords: ["photo", "图片"], run: () => image_input_ref.current?.click() },
      ]),
      { command_id: "clear", title: "/clear", description: "清空当前输入", keywords: ["reset", "清空"], run: () => { editor_ref.current?.commands.clearContent(); } },
      ...(props.group_mode && props.select_group_session ? (props.group_sessions ?? []).map((session) => ({ command_id: `sessions:${session.session_id}`, title: `/sessions ${session.session_id.slice(0, 8)}`, description: "切换 Group Session", keywords: ["session", "sessions", session.session_id], run: () => props.select_group_session?.(session.session_id) })) : []),
      ...(props.compact_session ? [{ command_id: "compact", title: "/compact", description: "压缩当前对话上下文", keywords: ["compact", "压缩", "context"], run: () => run_compact_command(true) }] : []),
      ...(props.group_mode || props.client_mode ? [] : props.models.map((model) => ({ command_id: `model:${model.model_id}`, title: `/model ${model.name}`, description: `切换到 ${model.model_id}`, keywords: ["model", "模型", model.model_id], run: () => props.set_model(model.model_id) }))),
      ...(props.group_mode || props.client_mode ? [] : (["ask", "always-allow"] as const).map((mode) => ({ command_id: `approval:${mode}`, title: `/approval ${mode}`, description: mode === "ask" ? "执行前询问" : "自动允许", keywords: ["approval", "权限"], run: () => props.set_approval_mode(mode) }))),
    ];
    const query = slash_query?.query.toLowerCase() ?? "";
    return commands.filter((command) => !query || `${command.title} ${command.keywords.join(" ")}`.toLowerCase().includes(query)).slice(0, 8);
  }, [props.compact_session, props.group_mode, props.group_sessions, props.models, props.select_group_session, props.set_approval_mode, props.set_model, run_compact_command, slash_query?.query]);

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

  return (<div className="chat-composer relative flex min-w-0 flex-none flex-col gap-2 p-1">
    <input ref={file_input_ref} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    <input ref={image_input_ref} type="file" multiple hidden accept="image/*" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    {!props.group_mode && !props.client_mode && props.queued_messages.length > 0 ? <QueuedMessageList {...props} /> : null}
    {attachment_error ? <div className="px-2 text-[11px] text-destructive">{attachment_error}</div> : null}
    {member_query && member_candidates.length > 0 ? <div className="absolute bottom-full left-1 z-30 mb-2 w-56 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none">{member_candidates.map((member) => <button key={member.agent_id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]" onMouseDown={(event) => event.preventDefault()} onClick={() => select_group_member(member)}><AgentAvatar agent={member} class_name="size-5 rounded" /><span className="min-w-0 flex-1 truncate">@{member.name}</span></button>)}</div> : slash_query ? <ChatSlashMenu commands={slash_commands} select_command={select_slash_command} /> : file_query && file_candidates.length > 0 ? <div className="absolute bottom-full left-1 z-30 mb-2 w-72 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none">{file_candidates.map((file) => <button key={file.relative_path} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]" onMouseDown={(event) => event.preventDefault()} onClick={() => void select_workspace_file(file)}><TbPaperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.relative_path}</span></button>)}</div> : null}
    <div className="chat-composer-editor min-h-20 max-h-60 w-full overflow-y-auto p-1">
      <EditorContent editor={editor} className="chat-composer-content" />
    </div>
    <div className="flex items-center justify-between gap-2 px-1 pb-1">
      {!props.group_mode && !props.client_mode ? <div className="flex min-w-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" className="rounded-full" aria-label="添加内容" title="添加内容" disabled={submitting}><TbPlus className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent side="top" sideOffset={4}>
            <DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>附件</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => image_input_ref.current?.click()}><TbPhoto className="size-4" /><span>图片</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChatModelSelector agent={props.agent} configuration={props.configuration} models={props.models} models_loading={props.models_loading} set_model={props.set_model} set_reasoning_effort={props.set_reasoning_effort} />
        <ChatApprovalModeSelector configuration={props.configuration} set_approval_mode={props.set_approval_mode} />
      </div> : <div />}
      <Button type="button" onClick={() => void (show_stop ? props.stop_session() : submit_message("send"))} disabled={submitting || (!show_stop && input_empty)} size="icon" variant="primary" className="rounded-full" aria-label={show_stop ? "停止生成" : busy ? "发送调整" : "发送消息"} title={show_stop ? "停止生成" : busy ? "发送调整；⌘/Ctrl + Shift + Enter 加入下一轮队列" : "发送消息"}>{show_stop ? <TbSquare className="size-4 stroke-3" /> : submitting ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>
    </div>
  </div>);
}

/** 输入框上方的待发送队列。 */
function QueuedMessageList(props: Pick<ChatInputEditorProps, "queued_messages" | "queue_paused" | "remove_queued_message" | "send_queued_message" | "update_queued_message" | "toggle_queued_message_paused" | "set_queue_paused" | "move_queued_message">) {
  const [editing, set_editing] = useState<{ message_id: string; text: string }>();
  const save_editing = () => {
    if (!editing?.text.trim()) return;
    props.update_queued_message(editing.message_id, editing.text);
    set_editing(undefined);
  };
  const action_class = "size-5 rounded-sm text-muted-foreground/70 [&_svg]:size-3";
  return <div className="chat-queued-message-list max-h-32 overflow-y-auto">
    <div className="flex min-h-6 items-center justify-end px-2">
      <Button className="h-5 gap-1 rounded-sm px-1 text-[0.625rem] text-muted-foreground/75 [&_svg]:size-3" title={props.queue_paused ? "恢复整个队列" : "暂停整个队列"} onClick={() => props.set_queue_paused(!props.queue_paused)}>{props.queue_paused ? <TbPlayerPlay /> : <TbPlayerPause />}{props.queue_paused ? "恢复队列" : "暂停队列"}</Button>
    </div>
    <div className="flex flex-col divide-y divide-border/30">{props.queued_messages.map((message, index) => {
      const is_editing = editing?.message_id === message.message_id;
      const text = read_chat_composer_text(message.input);
      const atom_count = count_chat_composer_atoms(message.input);
      const editable = !has_chat_composer_atoms(message.input);
      return <div key={message.message_id} className="flex min-h-7 items-center gap-0.5 px-2.5 py-1 text-[0.6875rem] text-muted-foreground">
        {message.sending ? <TbLoader2 className="size-3 shrink-0 animate-spin text-muted-foreground/65" /> : <TbCornerDownRight className="size-3 shrink-0 text-muted-foreground/45" />}
        {is_editing ? <><textarea autoFocus rows={1} value={editing.text} className="min-h-6 min-w-0 flex-1 resize-none rounded-sm border border-border/40 bg-background/50 px-1 py-0.5 text-[0.6875rem] text-foreground" onChange={(event) => set_editing({ message_id: message.message_id, text: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); save_editing(); } else if (event.key === "Escape") { event.preventDefault(); set_editing(undefined); } }} /><Button className={action_class} title="保存" onClick={save_editing}><TbCheck /></Button><Button className={action_class} title="取消" onClick={() => set_editing(undefined)}><TbX /></Button></> : <>
          <span className="min-w-0 flex-1 truncate px-1 py-0.5 text-foreground/70">{text || `${atom_count} 个内容`}</span>
          {message.paused && !message.sending ? <span className="shrink-0 px-1 text-[0.625rem] text-muted-foreground/70">已暂停</span> : null}
          <Button className={action_class} title={editable ? "编辑" : "包含附件或引用的消息不能在队列中编辑"} disabled={message.sending || !editable} onClick={() => set_editing({ message_id: message.message_id, text })}><TbPencil /></Button>
          <Button className={action_class} title={message.paused ? "恢复此项" : "暂停此项"} disabled={message.sending} onClick={() => props.toggle_queued_message_paused(message.message_id)}>{message.paused ? <TbPlayerPlay /> : <TbPlayerPause />}</Button>
          <Button className={action_class} title="上移" disabled={index === 0 || message.sending} onClick={() => props.move_queued_message(message.message_id, "up")}><TbArrowUp /></Button>
          <Button className={action_class} title="下移" disabled={index === props.queued_messages.length - 1 || message.sending} onClick={() => props.move_queued_message(message.message_id, "down")}><TbArrowDown /></Button>
          <Button className={action_class} title="立即发送为调整" disabled={message.sending} onClick={() => void props.send_queued_message(message.message_id)}><TbCornerDownRight /></Button>
          <Button className={action_class} title="删除队列消息" disabled={message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /></Button>
        </>}
      </div>;
    })}</div>
  </div>;
}

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`)); reader.readAsDataURL(file); });
}
