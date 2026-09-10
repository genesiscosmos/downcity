/** 正式会话输入组合模型工具栏、执行控制和独立订阅的发送队列。 */
import { RichTextEditor } from "./RichTextEditor";
import { use_agent_composer } from "./use_agent_composer";
import { MessageQueue } from "../components/MessageQueue";
import { use_store_selector } from "@/lib/store";
import { is_chat_busy } from "@/types/DesktopView";
import { get_session_key } from "../lib/chat_cache_key";
import type { AgentComposerProps } from "@/types/ChatComponents";

export function SessionComposer(props: AgentComposerProps) {
  const editor = use_agent_composer(props);
  const { selection, stores, actions } = props;
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "session" ? selection.session_id : selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const busy = use_store_selector(stores.chat_stream, state => is_chat_busy(state.chat_runtime_by_session[session_key]));
  return <RichTextEditor {...editor} busy={busy}
    enqueue_message={input => actions.send_message(workspace_id, agent_id, session_id, input, "queue")}
    stop_session={() => actions.stop_session(workspace_id, agent_id, session_id)}
    queue={<SessionMessageQueue {...props} />} />;
}

/** 队列变化只重绘队列，不影响编辑器文档及消息列表。 */
function SessionMessageQueue({ selection, stores, actions }: AgentComposerProps) {
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "session" ? selection.session_id : selection.draft_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const messages = use_store_selector(stores.composer, state => state.queued_messages_by_session[session_key]);
  const paused = use_store_selector(stores.composer, state => state.queue_paused_by_session[session_key]);
  if (!messages?.length) return null;
  return <MessageQueue queued_messages={messages} queue_paused={paused ?? false}
    remove_queued_message={id => actions.remove_queued_message(workspace_id, agent_id, session_id, id)}
    send_queued_message={id => actions.send_queued_message(workspace_id, agent_id, session_id, id)}
    update_queued_message={(id, text) => actions.update_queued_message(workspace_id, agent_id, session_id, id, text)}
    toggle_queued_message_paused={id => actions.toggle_queued_message_paused(workspace_id, agent_id, session_id, id)}
    set_queue_paused={value => actions.set_queue_paused(workspace_id, agent_id, session_id, value)}
    move_queued_message={(id, direction) => actions.move_queued_message(workspace_id, agent_id, session_id, id, direction)} />;
}
