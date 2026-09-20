/**
 * 输入区展开到右侧面板后的内容。
 *
 * ## 为什么复用同一个编辑器
 *
 * 面板里的输入区与正文里的输入区**是同一段草稿的两种呈现**：内容、附件、引用、队列
 * 与提交路径全都一样。所以这里不另写一套编辑器，而是复用 `RichTextEditor`，
 * 由场景注入同一套 `update_draft` / `send_message`。只有一份草稿来源，
 * 两种呈现之间不会分叉，也不必把附件、引用、Slash 的行为各维护一遍。
 *
 * ## 同一时刻只能有一个编辑器持有草稿
 *
 * Tiptap 实例各自持有一份文档，两个实例同时写同一个草稿会互相覆盖
 * （先写入的那份被后写入的整篇替换）。因此约定：**展开时正文里的那一份卸载**，
 * 收起时恢复。卸载时编辑器会把自己尚未同步的草稿写回 store（`onDestroy` 的 flush），
 * 而 React 在同一次提交里先跑卸载清理、再跑挂载副作用，所以面板里的新实例
 * 一定读到已经落盘的那份内容——顺序由框架保证，不靠事后同步去弥补。
 *
 * ## 内容必须自解析
 *
 * 标签页内容不能依赖构造它的那个视图的临时状态。标签页在重复打开时会**保留原来的
 * sections**（换掉会重新挂载内容、丢掉编辑中的状态），所以内容元素一旦构造出来
 * 就会长期存活：把 `draft_content` 这类会变的属性塞进去，它会永远停在构造那一刻的旧值。
 *
 * 因此内容只收 `selection` / `stores` / `actions` 这类稳定引用，草稿与运行时状态
 * 由内容组件自己订阅（见 `AgentComposerPanel`、`GroupComposerPanel`）。
 */

import { TbArrowsDiagonal, TbArrowsDiagonalMinimize2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./RichTextEditor";
import { use_agent_composer } from "./use_agent_composer";
import { use_group_composer } from "./use_group_composer";
import { MessageQueue } from "../components/MessageQueue";
import { use_store_selector } from "@/lib/store";
import { is_chat_busy } from "@/types/DesktopView";
import { get_group_chat_key, get_session_key } from "../lib/chat_cache_key";
import { baybar_tab_id, use_baybar_close_tab, use_baybar_open, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";
import type { AgentComposerProps, GroupComposerProps, RichTextEditorProps } from "@/types/ChatComponents";
import type { ReactNode } from "react";

/** 「输入区」标签页的种类标识；完整 id 还需拼上具体的对话标识。 */
export const COMPOSER_TAB_KIND = "composer";

/** 输入区标签页唯一分区的稳定标识。 */
export const COMPOSER_SECTION_ID = "composer";

/** 构造某个对话的输入区标签页标识。 */
export function composer_tab_id(session_key: string): string {
  return baybar_tab_id(COMPOSER_TAB_KIND, session_key);
}

/**
 * 正文输入区里的展开入口。
 *
 * 是否显示由编辑器决定（见 `RichTextEditor` 的 `expand_visibility`）：只有输入框非空时才出现。
 * 这里只负责「点它做什么」，不重复判断草稿状态——那会让按钮的出现时机晚一个防抖周期。
 *
 * `build_tab` 在点击时才调用：标签页按约定由调用方在点击处构造。
 */
export function ComposerExpandButton({ build_tab }: {
  /** 构造并打开对应的输入区标签页。 */
  build_tab(): BayBarTab;
}) {
  const translate_chat = use_translation("chat");
  const open_baybar = use_baybar_open();
  return <Button
    type="button"
    size="icon"
    className="rounded-full"
    onClick={() => open_baybar(build_tab(), COMPOSER_SECTION_ID)}
    aria-label={translate_chat("composer.expand")}
    title={translate_chat("composer.expand_hint")}
  ><TbArrowsDiagonal className="size-4" /></Button>;
}

/**
 * 面板里输入区的通用外壳。
 *
 * 与正文输入区的行为差别只有两条：
 * 1. 裸 Enter 只换行（`multiline_enter`）——面板本来就是为写长内容打开的；
 * 2. 挂载即接管焦点——用户点展开就是为了打字。
 *
 * 收起入口常驻（`expand_visibility="always"`）：它是退出面板的可见入口，
 * 不能随输入内容清空而消失。
 */
export function ComposerPanel({ editor, busy, has_pending_queue, stop_session, queue }: {
  /** 场景绑定出的编辑器属性。 */
  editor: RichTextEditorProps;
  /** 当前对话是否正在执行。 */
  busy: boolean;
  /** 是否已有待发送队列。 */
  has_pending_queue: boolean;
  /** 停止当前执行；草稿场景不提供。 */
  stop_session?(): Promise<void>;
  /** 队列区域。 */
  queue?: ReactNode;
}) {
  const translate_chat = use_translation("chat");
  const close_tab = use_baybar_close_tab();
  return <div className="composer-panel flex h-full min-h-0 flex-col p-2">
    <RichTextEditor
      {...editor}
      busy={busy}
      has_pending_queue={has_pending_queue}
      can_queue
      multiline_enter
      expand_visibility="always"
      auto_focus_on_mount
      stop_session={stop_session}
      // 收起入口放在发送按钮左侧，与正文里的展开入口是同一个动作的两端。
      expand={<Button
        type="button"
        size="icon"
        className="rounded-full"
        onClick={() => close_tab(composer_tab_id(editor.editor_key))}
        aria-label={translate_chat("composer.collapse")}
        title={translate_chat("composer.collapse_hint")}
      ><TbArrowsDiagonalMinimize2 className="size-4" /></Button>}
      queue={queue}
    />
  </div>;
}

/** 单聊输入区标签页的内容；自行订阅草稿与运行状态。 */
export function AgentComposerPanel(props: AgentComposerProps) {
  const editor = use_agent_composer(props);
  const { workspace_id, agent_id } = props.selection;
  const session_id = props.selection.kind === "session" ? props.selection.session_id : props.selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const busy = use_store_selector(props.stores.chat_stream, (state) => is_chat_busy(state.chat_runtime_by_session[session_key]));
  const has_pending_queue = use_store_selector(props.stores.composer, (state) => Boolean(state.queued_messages_by_session[session_key]?.length));
  return <ComposerPanel
    editor={editor}
    busy={busy}
    has_pending_queue={has_pending_queue}
    stop_session={() => props.actions.stop_session(workspace_id, agent_id, session_id)}
    queue={<AgentPanelQueue {...props} />}
  />;
}

/** 群聊输入区标签页的内容；自行订阅草稿与运行状态。 */
export function GroupComposerPanel(props: GroupComposerProps) {
  const editor = use_group_composer(props);
  const { group_id, workspace_id } = props.selection;
  const session_id = props.selection.kind === "group_draft" ? props.selection.draft_id : props.selection.session_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  const has_pending_queue = use_store_selector(props.stores.composer, (state) => Boolean(state.queued_messages_by_session[chat_key]?.length));
  return <ComposerPanel
    editor={editor}
    // 群聊的「忙碌」看群阶段而不是单个 Session 运行态，已在 `use_group_composer` 里算好。
    busy={editor.busy}
    has_pending_queue={has_pending_queue}
    stop_session={props.selection.kind === "group_session" ? () => props.actions.stop_group(group_id, session_id) : undefined}
  />;
}

/** 单聊队列详情由独立组件订阅；主输入区只感知队列是否为空。 */
function AgentPanelQueue({ selection, stores, actions }: AgentComposerProps) {
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "session" ? selection.session_id : selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const messages = use_store_selector(stores.composer, (state) => state.queued_messages_by_session[session_key]);
  const paused = use_store_selector(stores.composer, (state) => state.queue_paused_by_session[session_key]);
  if (!messages?.length) return null;
  return <MessageQueue
    queued_messages={messages}
    queue_paused={paused ?? false}
    remove_queued_message={(id) => actions.remove_queued_message(workspace_id, agent_id, session_id, id)}
    send_queued_message={(id) => actions.send_queued_message(workspace_id, agent_id, session_id, id)}
    update_queued_message={(id, text) => actions.update_queued_message(workspace_id, agent_id, session_id, id, text)}
    toggle_queued_message_paused={(id) => actions.toggle_queued_message_paused(workspace_id, agent_id, session_id, id)}
    set_queue_paused={(value) => actions.set_queue_paused(workspace_id, agent_id, session_id, value)}
    move_queued_message={(id, direction) => actions.move_queued_message(workspace_id, agent_id, session_id, id, direction)}
  />;
}

