/** 聊天富文本输入：编辑文档、处理引用与附件，通过明确回调提交输入。 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { TbArrowUp, TbLoader2, TbPaperclip, TbPhoto, TbPlus, TbSquare } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { ChatSubmitMode } from "@/types/DesktopView";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";
import type { RichTextEditorProps } from "@/types/ChatComponents";
import { create_chat_composer_extensions } from "@/features/chat/composer/editor/chatComposerExtensions";
import { ChatSlashMenu } from "@/features/chat/composer/editor/ChatSlashMenu";
import { is_chat_composer_empty } from "@/features/chat/composer/editor/chatComposerCodec";
import { empty_chat_content } from "@/features/chat/lib/chat_view_defaults";
import { should_apply_composer_focus } from "@/features/chat/composer/editor/composerFocus";
import { should_restore_editor_draft } from "@/features/chat/composer/editor/draftSync";
import { add_chat_reference_listener } from "@/features/chat/composer/editor/chatReferenceEvent";
import { add_chat_mention_listener } from "@/features/chat/composer/editor/chatMentionEvent";
import { is_plain_enter, resolve_chat_composer_enter_action } from "@/features/chat/composer/editor/chatComposerKeymap";
import { translate, use_translation } from "@/locales/i18n";

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

/** 一次等待写入 composer store 的本地草稿。 */
interface PendingDraftSync {
  /** Tiptap 当前完整 JSON 文档。 */
  draft: JSONContent;
  /** 草稿生成时对应的 Session 写入函数，避免切换 Session 后写错目标。 */
  update_draft(input: JSONContent): void;
}

/** 用户停止输入后同步草稿到领域 store 的等待时间。 */
const draft_sync_delay_ms = 300;

/** 支持结构化草稿、多媒体节点、Slash 命令和消息引用的输入表面。 */
export const RichTextEditor = memo(function RichTextEditor(props: RichTextEditorProps) {
  const translate_chat = use_translation("chat");
  const file_input_ref = useRef<HTMLInputElement>(null);
  const image_input_ref = useRef<HTMLInputElement>(null);
  const editor_ref = useRef<Editor | null>(null);
  const syncing_ref = useRef(false);
  const submitting_ref = useRef(false);
  const slash_query_ref = useRef<SlashQuery | undefined>(undefined);
  const file_query_ref = useRef<FileQuery | undefined>(undefined);
  const member_query_ref = useRef<MemberQuery | undefined>(undefined);
  const member_candidates_ref = useRef<DesktopAgentSummary[]>([]);
  const draft_sync_timeout_ref = useRef<number | null>(null);
  const pending_draft_sync_ref = useRef<PendingDraftSync | undefined>(undefined);
  const locally_published_draft_ref = useRef<JSONContent | undefined>(undefined);
  const loaded_editor_key_ref = useRef(props.editor_key);
  const applied_focus_request_ref = useRef(0);
  const props_ref = useRef(props);
  props_ref.current = props;
  const [submitting, set_submitting] = useState(false);
  const [input_empty, set_input_empty] = useState(() => is_chat_composer_empty(props.draft_content));
  const [attachment_error, set_attachment_error] = useState("");
  const [slash_query, set_slash_query] = useState<SlashQuery>();
  const [file_query, set_file_query] = useState<FileQuery>();
  const [member_query, set_member_query] = useState<MemberQuery>();
  const [workspace_files, set_workspace_files] = useState<import("@common/types/DesktopApi").DesktopWorkspaceFile[]>([]);
  slash_query_ref.current = slash_query;
  file_query_ref.current = file_query;
  member_query_ref.current = member_query;
  const busy = props.busy;

  /** 立即写回最后一份本地草稿，并清理等待中的计时器。 */
  const flush_pending_draft = useCallback(() => {
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = null;
    const pending_sync = pending_draft_sync_ref.current;
    pending_draft_sync_ref.current = undefined;
    if (!pending_sync) return;
    locally_published_draft_ref.current = pending_sync.draft;
    pending_sync.update_draft(pending_sync.draft);
  }, []);

  /** 放弃已由发送流程接管的本地草稿，避免迟到计时器把它重新写回。 */
  const discard_pending_draft = useCallback(() => {
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = null;
    pending_draft_sync_ref.current = undefined;
  }, []);

  /** 在输入空闲后把 Tiptap 文档同步到 composer store。 */
  const schedule_draft_sync = useCallback((current_editor: Editor) => {
    if (syncing_ref.current) return;
    const draft = current_editor.getJSON();
    set_input_empty(is_chat_composer_empty(draft));
    pending_draft_sync_ref.current = { draft, update_draft: props_ref.current.update_draft };
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = window.setTimeout(flush_pending_draft, draft_sync_delay_ms);
  }, [flush_pending_draft]);

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
    if (!props_ref.current.attachments) { set_file_query(undefined); return; }
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
    if (!props_ref.current.members) { set_member_query(undefined); return; }
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
    if (!props.attachments) {
      set_workspace_files([]);
      set_file_query(undefined);
      return;
    }
    let disposed = false;
    void props.attachments.list_files().then((files) => { if (!disposed) set_workspace_files(files); }).catch(() => { if (!disposed) set_workspace_files([]); });
    return () => { disposed = true; };
  }, [props.attachments]);

  async function insert_files(files: ArrayLike<File>) {
    if (!props_ref.current.attachments) return;
    const selected_files = Array.from(files);
    const too_large = selected_files.find((file) => file.size > 20 * 1024 * 1024);
    if (too_large) return set_attachment_error(translate_chat("composer.file_too_large", { name: too_large.name }));
    set_attachment_error("");
    try {
      const nodes = await Promise.all(selected_files.map(async (file) => ({ type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), filename: file.name, media_type: file.type || "application/octet-stream", data_url: await read_file_as_data_url(file) } })));
      editor_ref.current?.chain().focus().insertContent(nodes).run();
    } catch (reason) {
      set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /**
   * 输入被发送流程接管后，由编辑器自己同步清空。
   *
   * 清空必须发生在这里，不能依赖 composer store 删除草稿后的回灌：草稿写入 store 有 300ms
   * 防抖，快速输入后立即发送时 store 里根本没有该键，删除不产生任何状态变化，编辑器也就收不到
   * 清空信号，输入框会留下已经发出去的内容。
   *
   * 清空时禁止派发 update，否则「清空」会被当成一次用户输入重新写回 store。
   */
  const clear_editor_after_submit = useCallback(() => {
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.commands.clearContent(false);
    // 编辑器此刻的文档就是 store 中该 Session 的文档（键不存在等同于空文档），
    // 因此记录为本地已发布草稿，避免 store 的删除动作再触发一次无意义的回灌。
    locally_published_draft_ref.current = empty_chat_content;
    set_input_empty(true);
    set_slash_query(undefined);
    set_file_query(undefined);
    set_member_query(undefined);
  }, []);

  const submit_message = useCallback(async (mode: ChatSubmitMode = "send") => {
    const current_editor = editor_ref.current;
    if (!current_editor || submitting_ref.current) return;
    const input = current_editor.getJSON();
    if (is_chat_composer_empty(input)) return;
    set_submitting(true);
    submitting_ref.current = true;
    try {
      discard_pending_draft();
      clear_editor_after_submit();
      // 发送失败时 store 会把输入还原成草稿，编辑器由 store 回灌恢复；用户可见错误同样由 store 呈现。
      await props_ref.current.send_message(input, mode).catch(() => undefined);
      editor_ref.current?.commands.focus();
    } finally {
      submitting_ref.current = false;
      set_submitting(false);
    }
  }, [clear_editor_after_submit, discard_pending_draft]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: create_chat_composer_extensions(props.placeholder),
    content: props.draft_content,
      editorProps: {
      attributes: { class: "chat-input-editor", "data-chat-input": "true", spellcheck: String(props.spellcheck_enabled) },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length || !props_ref.current.attachments) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length || !props_ref.current.attachments) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (is_plain_enter(event)) {
          if (!props_ref.current.attachments && member_query_ref.current && member_candidates_ref.current[0]) {
            event.preventDefault();
            select_group_member(member_candidates_ref.current[0]);
            return true;
          }
          if (props_ref.current.attachments && file_query_ref.current && file_candidates[0]) {
            event.preventDefault();
            void select_workspace_file(file_candidates[0]);
            return true;
          }
        }
        const action = resolve_chat_composer_enter_action(event, view.state.doc.toJSON(), props_ref.current.multiline_enter);
        if (action === "native" || (action === "queue-paused" && !props_ref.current.can_queue)) return false;
        event.preventDefault();
        void submit_message(action === "submit-immediately" ? "steer" : action === "queue-paused" ? "queue" : "send");
        return true;
      },
    },
    onCreate: ({ editor: current_editor }) => { editor_ref.current = current_editor; },
    onUpdate: ({ editor: current_editor }) => { schedule_draft_sync(current_editor); update_slash_query(current_editor); update_file_query(current_editor); update_member_query(current_editor); },
    onSelectionUpdate: ({ editor: current_editor }) => { update_slash_query(current_editor); update_file_query(current_editor); update_member_query(current_editor); },
    onBlur: () => { flush_pending_draft(); },
    onDestroy: () => { flush_pending_draft(); editor_ref.current = null; },
  }, []);

  const show_stop = Boolean(props.stop_session) && busy && input_empty && !submitting;
  const queues_submission = busy || Boolean(props.has_pending_queue);

  useEffect(() => {
    if (!editor) return;
    if (!should_restore_editor_draft(loaded_editor_key_ref.current, props.editor_key, props.draft_content, locally_published_draft_ref.current)) return;
    discard_pending_draft();
    syncing_ref.current = true;
    editor.commands.setContent(props.draft_content);
    syncing_ref.current = false;
    loaded_editor_key_ref.current = props.editor_key;
    locally_published_draft_ref.current = undefined;
    set_input_empty(is_chat_composer_empty(props.draft_content));
    set_slash_query(undefined);
    set_file_query(undefined);
    set_member_query(undefined);
  }, [discard_pending_draft, editor, props.draft_content, props.editor_key]);

  /** Session 切换或组件卸载前强制保存最后一次尚未同步的输入。 */
  useEffect(() => () => { flush_pending_draft(); }, [flush_pending_draft, props.editor_key]);

  /** 新建对话后把键盘焦点交给输入框；序号变化保证每次请求只聚焦一次。 */
  useEffect(() => {
    const focus_request = props.focus_request ?? 0;
    if (!editor || !should_apply_composer_focus(focus_request, applied_focus_request_ref.current)) return;
    applied_focus_request_ref.current = focus_request;
    editor.commands.focus("end");
  }, [editor, props.focus_request]);

  /**
   * 展开到面板后直接接管键盘焦点。
   *
   * 只在挂载时做一次：依赖数组保持为空，之后重渲染不再抢焦点。
   * 光标落在文末，接着上次的位置继续写。
   */
  useEffect(() => {
    if (!editor || !props_ref.current.auto_focus_on_mount) return;
    editor.commands.focus("end");
  }, [editor]);

  useEffect(() => add_chat_reference_listener((reference) => {
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.chain().focus("end").insertContent({ type: "chatReference", attrs: { ...reference, preview_text: reference.text.replace(/\s+/g, " ").trim().slice(0, 80) } }).run();
  }), []);

  useEffect(() => add_chat_mention_listener((agent) => {
    if (!props_ref.current.members) return;
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.chain().focus("end").insertContent(`@${agent.name} `).run();
    set_member_query(undefined);
  }), []);

  const slash_commands = useMemo(() => {
    const commands: ChatSlashCommand[] = [
      ...(!props.attachments ? [] : [
        { command_id: "attach", title: "/attach", description: translate_chat("composer.attach_file"), keywords: ["file", "attachment"], run: () => file_input_ref.current?.click() },
        { command_id: "image", title: "/image", description: translate_chat("composer.attach_image"), keywords: ["photo", "image"], run: () => image_input_ref.current?.click() },
      ]),
      { command_id: "clear", title: "/clear", description: translate_chat("composer.clear"), keywords: ["reset", "clear"], run: () => { editor_ref.current?.commands.clearContent(); } },
    ];
    commands.push(...(props.commands ?? []));
    const query = slash_query?.query.toLowerCase() ?? "";
    return commands.filter((command) => !query || `${command.title} ${command.keywords.join(" ")}`.toLowerCase().includes(query)).slice(0, 8);
  }, [props.attachments, props.commands, slash_query?.query, translate_chat]);

  const file_candidates = useMemo(() => {
    const query = file_query?.query.toLowerCase() ?? "";
    return workspace_files.filter((file) => !query || file.relative_path.toLowerCase().includes(query)).slice(0, 8);
  }, [file_query?.query, workspace_files]);

  const member_candidates = useMemo(() => {
    const query = member_query?.query.toLowerCase() ?? "";
    return (props.members ?? []).filter((member) => !query || member.agent_id.toLowerCase().includes(query)).slice(0, 8);
  }, [member_query?.query, props.members]);
  member_candidates_ref.current = member_candidates;

  const select_workspace_file = useCallback(async (file: import("@common/types/DesktopApi").DesktopWorkspaceFile) => {
    if (!props_ref.current.attachments) return;
    const current_editor = editor_ref.current;
    if (!current_editor || !file_query) return;
    current_editor.chain().focus().deleteRange({ from: file_query.from, to: file_query.to }).run();
    set_file_query(undefined);
    try {
      const attachment = await props.attachments!.read_file(file.relative_path);
      current_editor.chain().focus().insertContent({ type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), ...attachment } }).run();
    } catch (reason) {
      set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  }, [file_query, props.attachments]);

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
    {props.queue}
    {attachment_error ? <div className="px-2 text-2xs text-destructive">{attachment_error}</div> : null}
    {member_query && member_candidates.length > 0 ? <div className="chat-composer-candidate-menu absolute bottom-full left-1 z-30 mb-2 w-56 overflow-hidden rounded-surface border border-border bg-background p-1 text-popover-foreground outline-none">{member_candidates.map((member) => <button key={member.agent_id} type="button" className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-xs outline-none hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30" onMouseDown={(event) => event.preventDefault()} onClick={() => select_group_member(member)}><AgentAvatar agent={member} class_name="size-5" /><span className="min-w-0 flex-1 truncate">@{member.name}</span></button>)}</div> : slash_query ? <ChatSlashMenu commands={slash_commands} select_command={select_slash_command} /> : file_query && file_candidates.length > 0 ? <div className="chat-composer-candidate-menu absolute bottom-full left-1 z-30 mb-2 w-72 overflow-hidden rounded-surface border border-border bg-background p-1 text-popover-foreground outline-none">{file_candidates.map((file) => <button key={file.relative_path} type="button" className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-xs outline-none hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30" onMouseDown={(event) => event.preventDefault()} onClick={() => void select_workspace_file(file)}><TbPaperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.relative_path}</span></button>)}</div> : null}
    <div className="chat-composer-editor min-h-20 max-h-60 w-full overflow-y-auto p-1">
      <EditorContent editor={editor} className="chat-composer-content" />
    </div>
    <div className="flex items-center justify-between gap-2 px-1 pb-1">
      <div className="flex min-w-0 items-center gap-1">
        {props.attachments ? <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" className="rounded-full" aria-label={translate_chat("composer.add_content")} title={translate_chat("composer.add_content")} disabled={submitting}><TbPlus className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent side="top" sideOffset={4}>
            <DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>{translate_chat("composer.attach_file")}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => image_input_ref.current?.click()}><TbPhoto className="size-4" /><span>{translate_chat("composer.attach_image")}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </> : null}
        {props.toolbar}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/*
          展开/收起入口的显示时机由场景决定（见 `expand_visibility`）。
          判空用编辑器自己的 `input_empty` 而不是草稿快照：草稿写入 store 有 300ms 防抖，
          读快照会让按钮晚一拍才出现。
        */}
        {input_empty && props.expand_visibility !== "always" ? null : props.expand}
        <Button type="button" onClick={() => void (show_stop ? props.stop_session?.() : submit_message("send"))} disabled={submitting || (!show_stop && input_empty)} size="icon" variant="primary" className="rounded-full" aria-label={translate_chat(show_stop ? "composer.stop" : queues_submission ? "composer.queue_message" : "composer.send_message")} title={translate_chat(show_stop ? "composer.stop" : queues_submission ? "composer.queue_message_hint" : "composer.send_message")}>{show_stop ? <TbSquare className="size-4 stroke-3" /> : submitting ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>
      </div>
    </div>
  </div>);
});

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error ?? new Error(translate("chat:composer.read_file_failed", { name: file.name }))); reader.readAsDataURL(file); });
}
