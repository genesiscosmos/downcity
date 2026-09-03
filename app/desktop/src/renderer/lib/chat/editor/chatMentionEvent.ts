/** Group 消息头像与当前 Chat Composer 之间的轻量 mention 事件。 */

import type { DesktopAgentSummary } from "@common/types/DesktopApi";

const event_name = "downcity:chat-mention";

/** 请求当前 Group Chat Composer 插入指定 Agent mention。 */
export function dispatch_chat_mention(agent: DesktopAgentSummary): void {
  window.dispatchEvent(new CustomEvent<DesktopAgentSummary>(event_name, { detail: agent }));
}

/** 监听发往当前 Group Chat Composer 的 Agent mention。 */
export function add_chat_mention_listener(listener: (agent: DesktopAgentSummary) => void): () => void {
  const handle_event = (event: Event) => listener((event as CustomEvent<DesktopAgentSummary>).detail);
  window.addEventListener(event_name, handle_event);
  return () => window.removeEventListener(event_name, handle_event);
}
