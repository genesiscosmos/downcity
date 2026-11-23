/** 聊天富文本输入：编辑文档、处理引用与附件，通过明确回调提交输入。 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { TbArrowUp, TbLoader2, TbPaperclip, TbPhoto, TbPlus, TbSquare } from "./input-icons";
import { InputButton as Button, InputMenu as DropdownMenu, InputMenuContent as DropdownMenuContent, InputMenuItem as DropdownMenuItem, InputMenuTrigger as DropdownMenuTrigger } from "./input-controls";
import { ComposerMentionMenu } from "./ComposerMentionMenu";
import type { ChatInputSubmitMode } from "../../types/chat-input";
import type { ChatSlashCommand } from "../../types/chat-input";
import type { ChatInputMember, ChatInputWorkspaceFile } from "../../types/chat-input";
import type { ChatInputProps } from "../../types/chat-input";
import { create_chat_composer_extensions } from "./chatComposerExtensions";
import { ChatSlashMenu } from "./ChatSlashMenu";
import { is_chat_composer_empty, is_chat_composer_node_empty } from "./chatComposerCodec";
import { parse_fenced_paste, read_chat_composer_code_fence } from "./chatComposerCodeFence";
import { create_chat_composer } from "./chatComposerCodec";
import { local_file_reference_node } from "./local_file_reference";

import { should_restore_editor_draft } from "./draftSync";
import { is_current_editor_async_target, type EditorAsyncTarget } from "./editor_async_target";
import { read_draft_agent_id, select_draft_agent } from "./draftAgentRecipient";
import { is_plain_enter, resolve_chat_composer_enter_action } from "./chatComposerKeymap";
import { ChatInputHostProvider, use_chat_input_host } from "./host";

/** Slash、Workspace 文件或 Group 成员候选共用的编辑器查询范围。 */
interface ComposerQuery {
  /** 查询文本，不含开头的 / 或 @。 */
  query: string;
  /** 查询触发字符在文档中的位置。 */
  from: number;
  /** 查询文本末端在文档中的位置。 */
  to: number;
  /** 缺少草稿负责人时自动展开；没有实际 @ 文本，只在光标处插入选中项。 */
  automatic?: boolean;
}

/** 查询文本与范围均未变化时，保留已有状态引用。 */
function retain_composer_query(current: ComposerQuery | undefined, next: ComposerQuery | undefined): ComposerQuery | undefined {
  return current?.query === next?.query && current?.from === next?.from && current?.to === next?.to && current?.automatic === next?.automatic ? current : next;
}

/** 一次等待写入 composer store 的本地草稿。 */
interface PendingDraftSync {
  /** 输入当时的不可变编辑文档；发布时才导出 JSON，切换后仍可安全保存。 */
  document: ProseMirrorNode;
  /** 草稿生成时对应的 Session 写入函数，避免切换 Session 后写错目标。 */
  update_draft(input: JSONContent): void;
}

const empty_chat_content = create_chat_composer();

/** 用户停止输入后同步草稿到领域 store 的等待时间。 */
const draft_sync_delay_ms = 300;

/** 支持结构化草稿、多媒体节点、Slash 命令和消息引用的输入表面。 */
const ChatInputEditor = memo(function ChatInputEditor(props: ChatInputProps) {
  const host = use_chat_input_host();
  const translate_chat = host.translate;
  const file_input_ref = useRef<HTMLInputElement>(null);
  const image_input_ref = useRef<HTMLInputElement>(null);
  const editor_ref = useRef<Editor | null>(null);
  /** 记录当前粘贴快捷键，ClipboardEvent 本身不携带键盘修饰键。 */
  const plain_paste_ref = useRef(false);
  const syncing_ref = useRef(false);
  const submitting_ref = useRef(false);
  /** 正在提交的原始目标；旧请求完成时只能释放自己占用的提交状态。 */
  const submission_target_ref = useRef<EditorAsyncTarget | undefined>(undefined);
  const slash_query_ref = useRef<ComposerQuery | undefined>(undefined);
  const file_query_ref = useRef<ComposerQuery | undefined>(undefined);
  const member_query_ref = useRef<ComposerQuery | undefined>(undefined);
  const member_candidates_ref = useRef<ChatInputMember[]>([]);
  const file_candidates_ref = useRef<ChatInputWorkspaceFile[]>([]);
  const member_index_ref = useRef(0);
  const member_menu_ref = useRef<HTMLDivElement>(null);
  const [member_index, set_member_index] = useState(0);
  const draft_sync_timeout_ref = useRef<number | null>(null);
  const pending_draft_sync_ref = useRef<PendingDraftSync | undefined>(undefined);
  const locally_published_draft_ref = useRef<JSONContent | undefined>(undefined);
  const loaded_editor_key_ref = useRef(props.editor_key);
  /**
   * 上一次上报过的草稿负责人；只在 @ 标记真的变化时才通知场景。
   *
   * 初值不做全文扫描：没有标记时任何上报都等于「仍是无」，有标记而地址不一致的情形
   * 由恢复后的首次事务或场景侧的校对处理。
   */
  const reported_recipient_ref = useRef<string | undefined>(undefined);
  /** 当前草稿的异步写入权限；layout cleanup 先撤销权限，再发布待保存草稿。 */
  const async_target_controller_ref = useRef<AbortController | undefined>(undefined);
  const applied_focus_request_ref = useRef(0);
  const props_ref = useRef(props);
  props_ref.current = props;
  const [submitting, set_submitting] = useState(false);
  const [input_empty, set_input_empty] = useState(() => is_chat_composer_empty(props.draft_content));
  const [attachment_error, set_attachment_error] = useState("");
  const [slash_query, set_slash_query] = useState<ComposerQuery>();
  const [file_query, set_file_query] = useState<ComposerQuery>();
  const [member_query, set_member_query] = useState<ComposerQuery>();
  const [recipient_missing, set_recipient_missing] = useState(() => Boolean(props.agent_recipients) && !read_draft_agent_id(props.draft_content));
  const [workspace_files, set_workspace_files] = useState<import("../../types/chat-input").ChatInputWorkspaceFile[]>([]);
  slash_query_ref.current = slash_query;
  file_query_ref.current = file_query;
  member_query_ref.current = member_query;
  const busy = props.busy;
  const stopping_editor_key_ref = useRef<string | undefined>(undefined);
  const [stopping_editor_key, set_stopping_editor_key] = useState<string>();
  const stopping = Boolean(props.stopping || stopping_editor_key === props.editor_key);
  /** IPC 发起后立即反馈；按输入所属会话隔离，失败时恢复操作并保留草稿。 */
  const stop_current_session = async () => {
    if (!props.stop_session || stopping || stopping_editor_key_ref.current === props.editor_key) return;
    const editor_key = props.editor_key;
    stopping_editor_key_ref.current = editor_key;
    set_stopping_editor_key(editor_key);
    try { await props.stop_session(); }
    catch (error) { if (props_ref.current.editor_key === editor_key) set_attachment_error(String(error)); }
    finally {
      if (stopping_editor_key_ref.current === editor_key) stopping_editor_key_ref.current = undefined;
      set_stopping_editor_key(current => current === editor_key ? undefined : current);
    }
  };

  /** 立即写回最后一份本地草稿，并清理等待中的计时器。 */
  const flush_pending_draft = useCallback(() => {
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = null;
    const pending_sync = pending_draft_sync_ref.current;
    pending_draft_sync_ref.current = undefined;
    if (!pending_sync) return;
    const publish = () => {
      const draft = pending_sync.document.toJSON();
      locally_published_draft_ref.current = draft;
      pending_sync.update_draft(draft);
    };
    publish();
  }, []);

  /** 放弃已由发送流程接管的本地草稿，避免迟到计时器把它重新写回。 */
  const discard_pending_draft = useCallback(() => {
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = null;
    pending_draft_sync_ref.current = undefined;
  }, []);

  /**
   * 上报草稿负责人的变化。
   *
   * @ 标记就是这段输入的接收方，它的变化必须立刻让场景切换地址与模型；
   * 只依赖 300ms 草稿防抖会出现「标记已删除，发送仍带着旧负责人」的窗口。
   * 上报前先把文档写回当前地址，场景迁移拿到的就是这份完整内容。
   */
  const report_recipient_change = useCallback((current_editor: Editor) => {
    const report = props_ref.current.on_recipient_change;
    if (!report) return;
    const agent_id = read_draft_agent_id(current_editor.state.doc.toJSON());
    if (agent_id === reported_recipient_ref.current) return;
    reported_recipient_ref.current = agent_id;
    flush_pending_draft();
    report(agent_id);
  }, [flush_pending_draft]);

  /** 在输入空闲后把 Tiptap 文档同步到 composer store。 */
  const schedule_draft_sync = useCallback((current_editor: Editor) => {
    if (syncing_ref.current) return;
    const document = current_editor.state.doc;
    set_input_empty(is_chat_composer_node_empty(document));
    pending_draft_sync_ref.current = { document, update_draft: props_ref.current.update_draft };
    // 原位方案确认需要实时知道是否还有未提交调整，不能等待聊天草稿防抖。
    if (props_ref.current.task_inline) { flush_pending_draft(); return; }
    if (draft_sync_timeout_ref.current !== null) window.clearTimeout(draft_sync_timeout_ref.current);
    draft_sync_timeout_ref.current = window.setTimeout(flush_pending_draft, draft_sync_delay_ms);
  }, [flush_pending_draft]);

  /** 每次编辑事务共用一份光标上下文，相同查询不重复触发渲染。 */
  const update_queries = useCallback((current_editor: Editor) => {
    const { compact, attachments } = props_ref.current;
    const members = props_ref.current.agent_recipients ?? props_ref.current.members;
    const { $from } = current_editor.state.selection;
    let next_slash_query: ComposerQuery | undefined;
    let next_mention_query: ComposerQuery | undefined;
    // 代码块中的 / 和 @ 保留字面量语义；所有查询共享一次文本提取。
    if ($from.parent.isTextblock && !$from.parent.type.spec.code && (!compact || attachments || members)) {
      const before_cursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
      const slash_match = compact || props_ref.current.slash_commands_enabled === false ? null : before_cursor.match(/(?:^|\s)\/([^\s/]*)$/);
      const mention_match = attachments || members ? before_cursor.match(/(?:^|\s)@([^\s@]*)$/) : null;
      if (slash_match) {
        const query = slash_match[1] ?? "";
        next_slash_query = { query, from: $from.pos - query.length - 1, to: $from.pos };
      }
      if (mention_match) {
        const query = mention_match[1] ?? "";
        next_mention_query = { query, from: $from.pos - query.length - 1, to: $from.pos };
        // 文件查询优先于 Slash；Group 成员查询可与文件候选共用同一范围。
        if (attachments) next_slash_query = undefined;
      }
    }
    const recipient_id = props_ref.current.agent_recipients ? read_draft_agent_id(current_editor.getJSON()) : undefined;
    const missing = Boolean(props_ref.current.agent_recipients) && !props_ref.current.agent_recipients?.some(agent => agent.agent_id === recipient_id);
    set_recipient_missing(missing);
    const automatic_query: ComposerQuery | undefined = missing && !props_ref.current.read_only && !submitting_ref.current
      ? { query: "", from: $from.pos, to: $from.pos, automatic: true }
      : undefined;
    const next_member_query = members ? next_mention_query ?? automatic_query : undefined;
    const next_file_query = attachments ? next_mention_query : undefined;
    member_query_ref.current = next_member_query;
    file_query_ref.current = next_file_query;
    set_slash_query((current) => retain_composer_query(current, next_slash_query));
    set_file_query((current) => retain_composer_query(current, next_file_query));
    set_member_query((current) => retain_composer_query(current, next_member_query));
  }, []);

  const select_group_member = useCallback((member: ChatInputMember) => {
    const current_editor = editor_ref.current;
    const query = member_query_ref.current;
    if (!current_editor || !query) return;
    if (props_ref.current.agent_recipients) {
      select_draft_agent(current_editor, member, query.from, query.to);
      flush_pending_draft();
    } else current_editor.chain().focus().deleteRange({ from: query.from, to: query.to }).insertContent(`@${member.name} `).run();
    set_member_query(undefined);
    member_query_ref.current = undefined;
    props_ref.current.on_select_member?.(member);
  }, [flush_pending_draft]);

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

  /** 捕获异步操作发起时的目标，不在 await 后重新选择当前编辑器。 */
  const capture_async_target = useCallback((): EditorAsyncTarget | undefined => {
    const current_editor = editor_ref.current;
    const controller = async_target_controller_ref.current;
    const editor_key = props_ref.current.editor_key;
    if (!current_editor || !controller || loaded_editor_key_ref.current !== editor_key) return;
    const target = { editor: current_editor, editor_key, signal: controller.signal };
    return is_current_editor_async_target(target, current_editor, editor_key) ? target : undefined;
  }, []);

  /** 迟到的成功和失败都不能修改另一会话或已交接宿主的状态。 */
  const target_is_current = useCallback((target: EditorAsyncTarget): boolean => (
    is_current_editor_async_target(target, editor_ref.current, props_ref.current.editor_key)
  ), []);

  /** 撤销当前异步结果应用权限，为仍挂载的同一草稿开启下一轮。 */
  const renew_async_target = useCallback(() => {
    const controller = async_target_controller_ref.current;
    controller?.abort();
    if (controller) async_target_controller_ref.current = new AbortController();
  }, []);

  async function insert_files(files: ArrayLike<File>) {
    if (!props_ref.current.attachments) return;
    const target = capture_async_target();
    if (!target) return;
    const selected_files = Array.from(files);
    const too_large = selected_files.find((file) => file.size > (props_ref.current.max_attachment_bytes ?? 20 * 1024 * 1024));
    if (too_large) return set_attachment_error(translate_chat("composer.file_too_large", { name: too_large.name }));
    set_attachment_error("");
    try {
      const nodes = await Promise.all(selected_files.map(async (file) => ({ type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), filename: file.name, media_type: file.type || "application/octet-stream", data_url: await read_file_as_data_url(file) } })));
      if (target_is_current(target)) insert_content_outside_code(target.editor, nodes);
    } catch (reason) {
      if (target_is_current(target)) set_attachment_error(reason instanceof Error ? reason.message : String(reason));
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
  const clear_editor_after_submit = useCallback((target_editor: Editor) => {
    target_editor.commands.clearContent(false);
    // 编辑器此刻的文档就是 store 中该 Session 的文档（键不存在等同于空文档），
    // 因此记录为本地已发布草稿，避免 store 的删除动作再触发一次无意义的回灌。
    locally_published_draft_ref.current = empty_chat_content;
    set_input_empty(true);
    set_slash_query(undefined);
    set_file_query(undefined);
    set_member_query(undefined);
  }, []);

  const submit_message = useCallback(async (mode: ChatInputSubmitMode = "send") => {
    const initial_target = capture_async_target();
    const submitted_props = props_ref.current;
    if (!initial_target || submitting_ref.current || submitted_props.read_only || submitted_props.submit_disabled || (!submitted_props.edit_mode && (submitted_props.stopping || stopping_editor_key_ref.current === submitted_props.editor_key)) || ((submitted_props.compact || submitted_props.task_inline) && submitted_props.busy)) return;
    const submitted_document = initial_target.editor.state.doc;
    const input = initial_target.editor.getJSON();
    // 鼠标、键盘都在清空前检查负责人；内部默认草稿地址不能替代显式选择。
    if (submitted_props.agent_recipients && !submitted_props.agent_recipients.some(agent => agent.agent_id === read_draft_agent_id(input))) {
      update_queries(initial_target.editor);
      return;
    }
    if (is_chat_composer_empty(input)) {
      if (submitted_props.compact && submitted_props.can_confirm_empty) await submitted_props.confirm_empty?.();
      return;
    }
    // 已发送草稿不再接受此前读取中的附件；本次发送捕获更新后的独立有效目标。
    renew_async_target();
    const target = capture_async_target();
    if (!target) return;
    const focus_owner = document.activeElement;
    submission_target_ref.current = target;
    set_submitting(true);
    submitting_ref.current = true;
    try {
      // 发送前校验需要保留原输入；先保存尚未防抖落盘的内容。
      if (submitted_props.clear_on_submit === "success") flush_pending_draft();
      discard_pending_draft();
      if (submitted_props.clear_on_submit === false) {
        // 草稿生成保留完整原文；交给所属场景呈现错误，不清空或依赖防抖回灌。
        await submitted_props.send_message(input, mode).catch(() => undefined);
      } else if (submitted_props.task_inline || submitted_props.clear_on_submit === "success") {
        // 成功后只清空本次提交的原文；等待期间继续编辑的内容必须保留。
        try {
          await submitted_props.send_message(input, mode);
          if (target_is_current(target) && target.editor.state.doc === submitted_document) {
            clear_editor_after_submit(target.editor);
          }
        } catch {
          // 宿主负责展示校验或业务错误，编辑器保留输入和光标。
        }
      } else {
        clear_editor_after_submit(target.editor);
        // 失败只恢复仍为空的原目标，不能覆盖用户等待期间输入的新内容。
        const cleared_document = target.editor.state.doc;
        try { await submitted_props.send_message(input, mode); }
        catch (error) {
          if (target_is_current(target)) {
            set_attachment_error(String(error));
            if (target.editor.state.doc === cleared_document) {
              target.editor.commands.setContent(input);
              schedule_draft_sync(target.editor);
              flush_pending_draft();
            }
          }
        }
      }
      // 不跨会话、宿主或草稿生命周期恢复焦点，也不覆盖用户主动选择的其它控件。
      if (target_is_current(target) && document.hasFocus()
        && (document.activeElement === focus_owner || target.editor.isFocused)
        && (!submitted_props.task_inline || props_ref.current.focus_request !== 0)) {
        target.editor.commands.focus();
      }
    } finally {
      if (submission_target_ref.current === target) {
        submission_target_ref.current = undefined;
        submitting_ref.current = false;
        set_submitting(false);
      }
    }
  }, [capture_async_target, clear_editor_after_submit, discard_pending_draft, flush_pending_draft, renew_async_target, target_is_current, update_queries]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: create_chat_composer_extensions(props.placeholder),
    content: props.draft_content,
    editable: !props.read_only,
      editorProps: {
      attributes: { class: "desktop-document-editor chat-input-editor downcity-writing-text", "data-chat-input": "true", spellcheck: String(props.spellcheck_enabled) },
      handleDOMEvents: {
        keyup: () => { plain_paste_ref.current = false; return false; },
        blur: () => { plain_paste_ref.current = false; return false; },
      },
      handlePaste: (view, event) => {
        if (props_ref.current.read_only) return true;
        if (plain_paste_ref.current) {
          plain_paste_ref.current = false;
          event.preventDefault();
          const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
          // 没有纯文本时直接消费事件，避免图片、引用或 HTML 回退为富文本粘贴。
          if (!text) return true;
          const { state } = view;
          const transaction = state.selection.$from.parent.type.spec.code
            ? state.tr.insertText(text)
            : state.tr.replaceSelection(new Slice(Fragment.from(text.split("\n").map((line) => (
              state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : null)
            ))), 1, 1));
          // 直接写入字面量，保留空行且不触发 Markdown 等粘贴规则。
          view.dispatch(transaction.scrollIntoView().setMeta("paste", true));
          return true;
        }
        /*
         * 代码块内交给 ProseMirror 原生行为：它对 `inCode` 上下文会把剪贴板纯文本
         * 原样插入（只把 CRLF 归一为 LF），正是写代码需要的语义。
         */
        if (view.state.selection.$from.parent.type.spec.code) return false;
        const files = event.clipboardData?.files;
        if (files?.length && props_ref.current.attachments) {
          event.preventDefault();
          void insert_files(files);
          return true;
        }
        // 独立本地文件地址保留为位置引用；不读取内容，也不进入附件上传流程。
        const has_reference_html = event.clipboardData?.getData("text/html").includes("data-downcity-reference");
        const in_inline_code = view.state.selection.$from.marks().some(mark => mark.type.name === "code");
        const file_reference = has_reference_html || in_inline_code ? undefined : local_file_reference_node(event.clipboardData?.getData("text/plain") ?? "");
        if (file_reference) {
          event.preventDefault();
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.chatReference.create(file_reference)).scrollIntoView().setMeta("paste", true));
          return true;
        }
        // 成对的围栏代码块整段恢复成 codeBlock；其余一律交回默认粘贴。
        const fenced_nodes = parse_fenced_paste(event.clipboardData?.getData("text/plain") ?? "");
        if (!fenced_nodes) return false;
        event.preventDefault();
        editor_ref.current?.chain().focus().insertContent(fenced_nodes).run();
        return true;
      },
      handleDrop: (_view, event) => {
        if (props_ref.current.read_only) return true;
        const files = event.dataTransfer?.files;
        if (!files?.length || !props_ref.current.attachments) return false;
        event.preventDefault();
        void insert_files(files);
        return true;
      },
      handleKeyDown: (view, event) => {
        plain_paste_ref.current = !event.isComposing && !view.composing && event.keyCode !== 229
          && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "v";
        if (props_ref.current.read_only) return false;
        // IME 确认输入不应选择候选或提交任务。
        if (event.isComposing || view.composing || event.keyCode === 229) return false;
        if (member_query_ref.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const candidates = member_candidates_ref.current;
          const files = props_ref.current.agent_recipients && !member_query_ref.current.automatic ? file_candidates_ref.current : [];
          const candidate_count = candidates.length + files.length;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            set_member_query(undefined);
            member_query_ref.current = undefined;
            return true;
          }
          if (candidate_count && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const next = (member_index_ref.current + direction + candidate_count) % candidate_count;
            member_index_ref.current = next;
            set_member_index(next);
            return true;
          }
          if (candidate_count && is_plain_enter(event)) {
            event.preventDefault();
            event.stopPropagation();
            const index = Math.min(member_index_ref.current, candidate_count - 1);
            if (index < candidates.length) select_group_member(candidates[index]);
            else void select_workspace_file(files[index - candidates.length]);
            return true;
          }
        }
        if (props_ref.current.task_inline && is_plain_enter(event)) {
          event.preventDefault();
          event.stopPropagation();
          if (!member_query_ref.current) void submit_message("send");
          return true;
        }
        if (is_plain_enter(event)) {
          if (!member_query_ref.current && props_ref.current.attachments && file_query_ref.current && file_candidates_ref.current[0]) {
            event.preventDefault();
            void select_workspace_file(file_candidates_ref.current[0]);
            return true;
          }
        }
        // 只有 Enter 策略需要文档结构，普通输入和方向键直接交给编辑器。
        if (event.key !== "Enter") return false;
        const { $from } = view.state.selection;
        const action = resolve_chat_composer_enter_action(event, view.state.doc.toJSON(), props_ref.current.multiline_enter, {
          in_code: Boolean($from.parent.type.spec.code),
          block_text: $from.parent.isTextblock ? $from.parent.textBetween(0, $from.parentOffset, "\n", "\0") : undefined,
        });
        if (action === "native" || (action === "queue-paused" && !props_ref.current.can_queue)) return false;
        event.preventDefault();
        // 围栏动作不提交：它只把当前段落转成代码块，让用户接着写代码。
        if (action === "code-fence") {
          apply_code_fence(editor_ref.current!);
          return true;
        }
        void submit_message(action === "submit-immediately" ? "steer" : action === "queue-paused" ? "queue" : "send");
        return true;
      },
    },
    onCreate: ({ editor: current_editor }) => { editor_ref.current = current_editor; },
    onUpdate: ({ editor: current_editor }) => {
      schedule_draft_sync(current_editor);
      if (!syncing_ref.current) report_recipient_change(current_editor);
    },
    onTransaction: ({ editor: current_editor, transaction, appendedTransactions: appended_transactions }) => {
      // 输入规则等插件可能追加文档或选区变更，仍只按事务最终状态更新一次查询。
      const changed = transaction.docChanged || transaction.selectionSet || appended_transactions.some((appended) => appended.docChanged || appended.selectionSet);
      if (changed) update_queries(current_editor);
    },
    onFocus: ({ editor: current_editor }) => { update_queries(current_editor); },
    onBlur: () => { flush_pending_draft(); set_member_query(undefined); member_query_ref.current = undefined; },
    onDestroy: () => { flush_pending_draft(); editor_ref.current = null; },
  }, []);
  const can_stop = Boolean(props.stop_session) && (busy || stopping) && !props.compact && !props.task_inline && !props.edit_mode;
  const show_stop = can_stop && input_empty;
  const stop_button = can_stop ? <Button type="button" onClick={() => void stop_current_session()} disabled={props.read_only || stopping} size="icon" variant="primary" className="rounded-full" aria-label={translate_chat(stopping ? "message.stopping" : "composer.stop")} title={translate_chat(stopping ? "message.stopping" : "composer.stop")}>{stopping ? <TbLoader2 className="size-4 animate-spin" /> : <TbSquare className="size-4 stroke-3" />}</Button> : null;
  /**
   * 本次提交是否会落到待发送队列。
   *
   * `can_queue` 参与判定：Group 聊天不走本地队列，不能让它的按钮也提示「加入队列」。
   */
  const queues_submission = Boolean(props.can_queue) && (busy || Boolean(props.has_pending_queue));

  useEffect(() => {
    if (!editor) return;
    if (!should_restore_editor_draft(loaded_editor_key_ref.current, props.editor_key, props.draft_content, locally_published_draft_ref.current)) return;
    renew_async_target();
    discard_pending_draft();
    syncing_ref.current = true;
    try {
      editor.commands.setContent(props.draft_content);
    } finally { syncing_ref.current = false; }
    loaded_editor_key_ref.current = props.editor_key;
    reported_recipient_ref.current = read_draft_agent_id(props.draft_content);
    locally_published_draft_ref.current = undefined;
    set_input_empty(is_chat_composer_empty(props.draft_content));
    set_slash_query(undefined);
    set_file_query(undefined);
    set_member_query(undefined);
    set_attachment_error("");
    update_queries(editor);
  }, [discard_pending_draft, editor, props.draft_content, props.editor_key, renew_async_target, update_queries]);

  /** 新建页、目录加载及展开面板交接后，缺少负责人时立即提供 Agent 候选。 */
  useEffect(() => {
    if (editor) update_queries(editor);
  }, [editor, props.editor_key, props.agent_recipients, props.read_only, update_queries]);

  /** 宿主交接先撤销迟到写入，再发布待保存草稿；新会话创建独立的权限。 */
  useLayoutEffect(() => {
    const controller = new AbortController();
    async_target_controller_ref.current = controller;
    const unregister_draft_sync = host.register_draft_sync?.(props.editor_key, flush_pending_draft);
    set_submitting(false);
    return () => {
      // 旧会话的请求仍可完成，但不能占用或释放新会话的提交锁。
      submission_target_ref.current = undefined;
      submitting_ref.current = false;
      controller.abort();
      async_target_controller_ref.current?.abort();
      async_target_controller_ref.current = undefined;
      unregister_draft_sync?.();
      flush_pending_draft();
    };
  }, [flush_pending_draft, props.editor_key, host.register_draft_sync]);

  /** 新建对话后把键盘焦点交给输入框；序号变化保证每次请求只聚焦一次。 */
  useEffect(() => {
    const focus_request = props.focus_request ?? 0;
    if (!editor || !(focus_request > 0 && focus_request !== applied_focus_request_ref.current)) return;
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

  useEffect(() => host.subscribe_reference?.((reference) => {
    const current_editor = editor_ref.current;
    if (!current_editor || props_ref.current.read_only) return;
    const file_location = reference.relative_path
      ? `${reference.relative_path}${reference.line_start ? `:${reference.line_start}${reference.line_end && reference.line_end !== reference.line_start ? `-${reference.line_end}` : ""}` : ""}`
      : undefined;
    const preview_text = file_location ?? reference.text.replace(/\s+/g, " ").trim().slice(0, 80);
    current_editor.chain().focus("end").insertContent({ type: "chatReference", attrs: { ...reference, preview_text } }).run();
  }), [host.subscribe_reference]);

  useEffect(() => {
    if (!editor || props.task_inline || props.compact) return;
    return host.register_reference_target?.(props.editor_key, (reference) => {
      if (editor.isDestroyed || !editor.isEditable || !editor.view.dom.isConnected) return false;
      const { doc } = editor.state;
      const node = { type: "chatReference", attrs: reference };
      // 代码块只接受纯文本；在文档末尾另起段落保留引用节点。
      const inserted = Selection.atEnd(doc).$from.parent.type.spec.code
        ? editor.chain().insertContentAt(doc.content.size, { type: "paragraph", content: [node] }).focus("end").run()
        : editor.chain().focus("end").insertContent(node).run();
      if (inserted) flush_pending_draft();
      return inserted;
    });
  }, [editor, props.editor_key, props.task_inline, props.compact, flush_pending_draft, host.register_reference_target]);

  useEffect(() => host.subscribe_mention?.((agent) => {
    if (!props_ref.current.members) return;
    const current_editor = editor_ref.current;
    if (!current_editor) return;
    current_editor.chain().focus("end").insertContent(`@${agent.name} `).run();
    set_member_query(undefined);
  }), [host.subscribe_mention]);

  const slash_commands = useMemo(() => {
    const commands: ChatSlashCommand[] = [
      ...(!props.attachments ? [] : [
        { command_id: "attach", title: "/attach", description: translate_chat("composer.attach_file"), keywords: ["file", "attachment"], run: () => file_input_ref.current?.click() },
        { command_id: "image", title: "/image", description: translate_chat("composer.attach_image"), keywords: ["photo", "image"], run: () => image_input_ref.current?.click() },
      ]),
      { command_id: "clear", title: "/clear", description: translate_chat("composer.clear"), keywords: ["reset", "clear"], run: () => { renew_async_target(); editor_ref.current?.commands.clearContent(); } },
    ];
    commands.push(...(props.commands ?? []));
    const query = slash_query?.query.toLowerCase() ?? "";
    return commands.filter((command) => !query || `${command.title} ${command.keywords.join(" ")}`.toLowerCase().includes(query)).slice(0, 8);
  }, [props.attachments, props.commands, renew_async_target, slash_query?.query, translate_chat]);

  const file_candidates = useMemo(() => {
    const query = file_query?.query.toLowerCase() ?? "";
    return workspace_files.filter((file) => !query || file.relative_path.toLowerCase().includes(query)).slice(0, 8);
  }, [file_query?.query, workspace_files]);

  file_candidates_ref.current = file_candidates;
  const member_candidates = useMemo(() => {
    const query = member_query?.query.toLowerCase() ?? "";
    return (props.agent_recipients ?? props.members ?? []).filter((member) => !query || member.agent_id.toLowerCase().includes(query) || member.name.toLowerCase().includes(query)).slice(0, 8);
  }, [member_query?.query, props.members, props.agent_recipients]);
  member_candidates_ref.current = member_candidates;
  useEffect(() => {
    member_index_ref.current = 0;
    set_member_index(0);
  }, [member_query?.query, member_query?.from, props.members, props.agent_recipients]);
  useEffect(() => {
    member_menu_ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [member_index, member_query?.query]);

  const select_workspace_file = useCallback(async (file: import("../../types/chat-input").ChatInputWorkspaceFile) => {
    const attachments = props_ref.current.attachments;
    const query = file_query_ref.current;
    const target = capture_async_target();
    if (!attachments || !target || !query) return;
    target.editor.chain().focus().deleteRange({ from: query.from, to: query.to }).run();
    set_file_query(undefined);
    set_member_query(undefined);
    member_query_ref.current = undefined;
    set_attachment_error("");
    try {
      const attachment = await attachments.read_file(file.relative_path);
      if (target_is_current(target)) {
        insert_content_outside_code(target.editor, { type: "chatAttachment", attrs: { attachment_id: crypto.randomUUID(), ...attachment } });
      }
    } catch (reason) {
      if (target_is_current(target)) set_attachment_error(reason instanceof Error ? reason.message : String(reason));
    }
  }, [capture_async_target, target_is_current]);

  const select_slash_command = useCallback((command: ChatSlashCommand) => {
    const current_editor = editor_ref.current;
    if (!current_editor || !slash_query) return;
    current_editor.chain().focus().deleteRange({ from: slash_query.from, to: slash_query.to }).run();
    set_slash_query(undefined);
    void command.run();
  }, [slash_query]);

  useLayoutEffect(() => {
    if (editor && editor.isEditable === Boolean(props.read_only)) editor.setEditable(!props.read_only);
  }, [editor, props.read_only]);

  return (<div role={props.edit_mode ? "group" : undefined} aria-label={props.edit_mode?.aria_label} data-composer-mode={props.edit_mode ? "edit" : undefined} className={`desktop-editor-surface flex min-w-0 flex-col ${props.compact ? "" : "chat-composer"} relative flex-none gap-2 p-1`}>
    <input ref={file_input_ref} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    <input ref={image_input_ref} type="file" multiple hidden accept="image/*" onChange={(event) => { void insert_files(event.target.files ?? []); event.currentTarget.value = ""; }} />
    {attachment_error ? <div className="px-2 text-2xs text-destructive">{attachment_error}</div> : null}
    {member_query ? <ComposerMentionMenu agent_only={member_query.automatic} menu_ref={member_menu_ref} agents={member_candidates} files={props.agent_recipients && !member_query.automatic ? file_candidates : []} selected_index={member_index} set_index={index => { member_index_ref.current = index; set_member_index(index); }} select_agent={select_group_member} select_file={file => void select_workspace_file(file)} /> : slash_query ? <ChatSlashMenu commands={slash_commands} select_command={select_slash_command} /> : file_query && file_candidates.length > 0 ? <div className="chat-composer-candidate-menu absolute bottom-full left-1 z-30 mb-2 w-72 overflow-hidden rounded-surface border border-border bg-background p-1 text-popover-foreground outline-none">{file_candidates.map((file) => <button key={file.relative_path} type="button" className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-xs outline-none hover:bg-interaction-hover focus-visible:bg-interaction-hover" onMouseDown={(event) => event.preventDefault()} onClick={() => void select_workspace_file(file)}><TbPaperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.relative_path}</span></button>)}</div> : null}
    <div className="chat-composer-editor min-h-20 max-h-60 w-full overflow-y-auto p-1">
      <EditorContent editor={editor} className="chat-composer-content" />
    </div>
    <div className="chat-composer-actions flex items-center justify-between gap-2 px-1 pb-1">
      <div className="chat-composer-toolbar flex min-w-0 items-center gap-1">
        {props.attachments && !props.compact ? <>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon" className="rounded-full" aria-label={translate_chat("composer.add_content")} title={translate_chat("composer.add_content")} disabled={submitting} />}><TbPlus className="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => file_input_ref.current?.click()}><TbPaperclip className="size-4" /><span>{translate_chat("composer.attach_file")}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => image_input_ref.current?.click()}><TbPhoto className="size-4" /><span>{translate_chat("composer.attach_image")}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </> : null}
        {!props.compact || props.task_inline ? props.toolbar : null}
      </div>
      <div className="chat-composer-submit flex shrink-0 items-center gap-1">
        {/*
          展开/收起入口的显示时机由场景决定（见 `expand_visibility`）。
          判空用编辑器自己的 `input_empty` 而不是草稿快照：草稿写入 store 有 300ms 防抖，
          读快照会让按钮晚一拍才出现。
        */}
        {input_empty && props.expand_visibility !== "always" ? null : props.expand}
        {can_stop && !show_stop ? stop_button : null}
        {props.edit_mode ? <>
          <Button type="button" disabled={submitting} onClick={props.edit_mode.cancel}>{translate_chat("queue.cancel")}</Button>
          <Button type="button" variant="primary" disabled={props.read_only || props.submit_disabled || submitting || input_empty} onClick={() => void submit_message("send")}>{props.edit_mode.confirm_label}</Button>
        </> : props.compact || props.task_inline ? <Button type="button" variant="primary" disabled={props.read_only || props.submit_disabled || busy || stopping || submitting || (input_empty && !props.can_confirm_empty)} onClick={() => void (input_empty ? props.confirm_empty?.() : submit_message("send"))}>{busy || submitting ? <TbLoader2 className="size-4 animate-spin" /> : null}{props.submit_label || "提交"}</Button> : show_stop ? stop_button : <Button type="button" onClick={() => void submit_message("send")} disabled={props.read_only || props.submit_disabled || recipient_missing || stopping || submitting || input_empty} size="icon" variant="primary" className="rounded-full" aria-label={props.submit_label || translate_chat(queues_submission ? "composer.queue_message" : "composer.send_message")} title={props.submit_label || translate_chat(queues_submission ? "composer.queue_message_hint" : "composer.send_message")}>{submitting || (props.read_only && busy) ? <TbLoader2 className="size-4 animate-spin" /> : <TbArrowUp className="size-4 stroke-3" />}</Button>}
      </div>
    </div>
  </div>);
});

/**
 * 把当前段落开头到光标之间的围栏行换成空代码块。
 *
 * 必须显式 `deleteRange` 再 `setCodeBlock`，不能只调 `setCodeBlock`：
 * `setBlockType` 会保留块内文本，那三个反引号与语言会留在代码的第一行。
 *
 * 位置从段落起点算而不是从光标回退固定长度：段落里可能还有前导空格，
 * 回退会漏掉它们，在代码里留下空格。
 */
function apply_code_fence(current_editor: Editor): void {
  const { $from } = current_editor.state.selection;
  const fence = read_chat_composer_code_fence($from.parent.textBetween(0, $from.parentOffset, "\n", "\0"));
  if (!fence) return;
  const chain = current_editor.chain().focus().deleteRange({ from: $from.start(), to: $from.pos });
  // 无语言的围栏不传 attrs：`setCodeBlock` 的参数类型要求 language 必填，但空对象会被 schema 默认值接管。
  if (fence.language) chain.setCodeBlock({ language: fence.language }).run();
  else chain.setCodeBlock().run();
}

/** 在代码块外插入内容：代码块的内容模型是 `text*`，放不下原子节点。 */
function insert_content_outside_code(current_editor: Editor, content: Parameters<Editor["commands"]["insertContent"]>[0]): void {
  const in_code = current_editor.state.selection.$from.parent.type.spec.code;
  current_editor.chain().focus(in_code ? "end" : undefined).insertContent(content).run();
}

/** 把浏览器文件读取成可跨 IPC 传递的 Data URL。 */
function read_file_as_data_url(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`)); reader.readAsDataURL(file); });
}

/** 可复用富文本输入；宿主只持有草稿、提交与外部能力。 */
export function ChatInput(props: ChatInputProps) {
  return <ChatInputHostProvider host={props.host}><ChatInputEditor key={props.draft_scope ?? "draft"} {...props} /></ChatInputHostProvider>;
}
