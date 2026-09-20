/**
 * 正式会话输入：模型工具栏、执行控制、独立订阅的发送队列，以及展开到右侧面板的形态。
 *
 * ## 展开是「换个宿主」，不是换一套实现
 *
 * 面板里的输入区与正文里的输入区是同一段草稿的两种呈现，因此两者共用同一个
 * `RichTextEditor` 与同一套 `use_agent_composer` 绑定。区别只有两点：
 *
 * 1. **同一时刻只渲染一个。** Tiptap 实例各自持有一份文档，两个实例写同一个草稿会
 *    互相覆盖。所以展开时正文那一份直接卸载（而不是隐藏），收起时恢复。
 * 2. 面板里裸 Enter 只换行：面板本来就是为写长内容打开的。
 *
 * 「该不该渲染正文那一份」只在这里判断一次，输入区组件本身不需要知道面板开着。
 */

import { RichTextEditor } from "./RichTextEditor";
import { AgentComposerPanel, ComposerExpandButton, composer_tab_id } from "./ComposerPanel";
import { use_agent_composer } from "./use_agent_composer";
import { MessageQueue } from "../components/MessageQueue";
import { TbArrowsDiagonal } from "react-icons/tb";
import { useEffect } from "react";
import { use_store_selector } from "@/lib/store";
import { use_baybar_set_tab_label, use_baybar_tab_active, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { is_chat_busy } from "@/types/DesktopView";
import { get_session_key } from "../lib/chat_cache_key";
import { use_translation } from "@/locales/i18n";
import type { AgentComposerProps } from "@/types/ChatComponents";
export function SessionComposer(props: AgentComposerProps) {
  const translate_chat = use_translation("chat");
  const { selection, stores, actions } = props;
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "session" ? selection.session_id : selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const editor = use_agent_composer(props);
  const busy = use_store_selector(stores.chat_stream, (state) => is_chat_busy(state.chat_runtime_by_session[session_key]));
  const has_pending_queue = use_store_selector(stores.composer, (state) => Boolean(state.queued_messages_by_session[session_key]?.length));
  // 展开状态直接读标签页本身：它是唯一真相，不再另存一份「谁展开了」的标记。
  const tab_id = composer_tab_id(session_key);
  const expanded = use_baybar_tab_active(tab_id);
  const set_tab_label = use_baybar_set_tab_label();
  /**
   * 把当前对话名同步到已展开的标签页。
   *
   * 标签页只在打开那一刻收下标题，而 Session 标题是**异步**产生的：首条消息落盘后
   * 才由模型生成，之后还可能被重命名。没有这条同步，一个在标题生成前展开的输入区
   * 会永远停在「新对话」上。
   *
   * 为什么放在这里而不是面板内容里：标签页内容只收 selection / stores / actions
   * 这类稳定引用（它会被长期保留，塞入会变的属性就会停在构造那一刻的旧值），
   * 因此拿不到实时标题。而本组件在展开时**依然挂载**（只是返回 null），
   * 是唯一同时看得到「实时标题」与「标签页 id」的地方。
   *
   * store 在标题未变或标签页不存在时不提交，不会因此产生多余渲染。
   */
  const label = props.session_label || translate_chat("conversation.new");
  useEffect(() => { set_tab_label(tab_id, label); }, [label, set_tab_label, tab_id]);
  if (expanded) return null;
  return <RichTextEditor
    {...editor}
    busy={busy}
    has_pending_queue={has_pending_queue}
    can_queue
    stop_session={() => actions.stop_session(workspace_id, agent_id, session_id)}
    expand={<ComposerExpandButton build_tab={() => agent_composer_tab(props, translate_chat)} />}
    queue={<SessionMessageQueue {...props} />}
  />;
}

/**
 * 构造单聊的输入区标签页。
 *
 * 标题用**对话名**：输入区是会话的一个侧面、自己没有名字，而标签行上可能同时开着
 * 多个对话的输入区，能区分它们的只有对话名。
 */
export function agent_composer_tab(props: AgentComposerProps, t_chat: BayBarTranslate): BayBarTab {
  const { workspace_id, agent_id } = props.selection;
  const session_id = props.selection.kind === "session" ? props.selection.session_id : props.selection.draft_id;
  return {
    id: composer_tab_id(get_session_key(workspace_id, agent_id, session_id)),
    label: props.session_label || t_chat("conversation.new"),
    icon: <TbArrowsDiagonal />,
    sections: [{
      id: "composer",
      label: t_chat("composer.panel_section"),
      content: <AgentComposerPanel selection={props.selection} stores={props.stores} actions={props.actions} />,
    }],
  };
}

/** 队列详情由独立组件订阅；主输入区只感知队列是否为空。 */
function SessionMessageQueue({ selection, stores, actions }: AgentComposerProps) {
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "session" ? selection.session_id : selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const messages = use_store_selector(stores.composer, (state) => state.queued_messages_by_session[session_key]);
  const paused = use_store_selector(stores.composer, (state) => state.queue_paused_by_session[session_key]);
  if (!messages?.length) return null;
  return <MessageQueue queued_messages={messages} queue_paused={paused ?? false}
    remove_queued_message={(id) => actions.remove_queued_message(workspace_id, agent_id, session_id, id)}
    send_queued_message={(id) => actions.send_queued_message(workspace_id, agent_id, session_id, id)}
    update_queued_message={(id, text) => actions.update_queued_message(workspace_id, agent_id, session_id, id, text)}
    toggle_queued_message_paused={(id) => actions.toggle_queued_message_paused(workspace_id, agent_id, session_id, id)}
    set_queue_paused={(value) => actions.set_queue_paused(workspace_id, agent_id, session_id, value)}
    move_queued_message={(id, direction) => actions.move_queued_message(workspace_id, agent_id, session_id, id, direction)} />;
}
