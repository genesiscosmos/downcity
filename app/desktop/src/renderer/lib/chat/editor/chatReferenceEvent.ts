/** Session 消息操作与当前 Chat Composer 之间的轻量引用事件。 */

import type { DesktopChatReferenceInput } from "@common/types/DesktopApi";

const event_name = "downcity:chat-reference";

/** 请求当前 Chat Composer 插入一条消息引用。 */
export function dispatch_chat_reference(reference: DesktopChatReferenceInput): void {
  window.dispatchEvent(new CustomEvent<DesktopChatReferenceInput>(event_name, { detail: reference }));
}

/** 监听发往当前 Chat Composer 的消息引用。 */
export function add_chat_reference_listener(listener: (reference: DesktopChatReferenceInput) => void): () => void {
  const handle_event = (event: Event) => listener((event as CustomEvent<DesktopChatReferenceInput>).detail);
  window.addEventListener(event_name, handle_event);
  return () => window.removeEventListener(event_name, handle_event);
}
