/**
 * Session 消息正文选区的引用入口。
 *
 * 组件只读取浏览器临时 Selection，不持有消息或输入草稿；确认引用后复用
 * Chat Composer 的结构化引用事件，由当前 Session 输入框接管持久状态。
 */

import { useEffect, useState, type RefObject } from "react";
import type { ChatTextSelection } from "@/types/ChatTextSelection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { use_translation } from "@/locales/i18n";

/** 可被引用的消息正文节点携带的稳定元数据。 */
interface SelectableMessageSurface {
  /** canonical 消息标识。 */
  message_id: string;
  /** 消息身份。 */
  role: "user" | "assistant";
}

/** 在当前 Session 消息区内展示选区引用按钮。 */
export function ChatTextSelectionQuote({ container_ref, session_id }: { /** 消息滚动容器。 */ container_ref: RefObject<HTMLDivElement | null>; /** 当前 Session 标识，用于切换会话时清理临时选区。 */ session_id: string }) {
  const translate = use_translation("chat");
  const [selected, set_selected] = useState<ChatTextSelection>();

  useEffect(() => {
    const resolve_selection = () => set_selected(read_chat_text_selection(container_ref.current, window.getSelection()));
    const clear_selection = () => set_selected(undefined);
    const handle_selection_change = () => {
      if (window.getSelection()?.isCollapsed !== false) clear_selection();
    };
    const handle_key_up = (event: KeyboardEvent) => {
      if (event.key === "Shift" || event.shiftKey) resolve_selection();
    };
    const container = container_ref.current;
    container?.addEventListener("pointerup", resolve_selection);
    container?.addEventListener("keyup", handle_key_up);
    container?.addEventListener("scroll", clear_selection);
    document.addEventListener("selectionchange", handle_selection_change);
    window.addEventListener("resize", clear_selection);
    return () => {
      container?.removeEventListener("pointerup", resolve_selection);
      container?.removeEventListener("keyup", handle_key_up);
      container?.removeEventListener("scroll", clear_selection);
      document.removeEventListener("selectionchange", handle_selection_change);
      window.removeEventListener("resize", clear_selection);
    };
  }, [container_ref, session_id]);

  if (!selected) return null;
  const insert_reference = () => {
    dispatch_chat_reference({ message_id: selected.message_id, role: selected.role, text: selected.text });
    window.getSelection()?.removeAllRanges();
    set_selected(undefined);
  };
  return <button
    type="button"
    className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground transition-colors hover:border-foreground/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    style={{ left: selected.viewport_x, top: selected.viewport_y }}
    onPointerDown={(event) => event.preventDefault()}
    onClick={insert_reference}
  >{translate("message.quote")}</button>;
}

/** 从浏览器 Selection 中读取一段属于同一消息正文的有效文本。 */
function read_chat_text_selection(container: HTMLElement | null, selection: Selection | null): ChatTextSelection | undefined {
  if (!container || !selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined;
  const range = selection.getRangeAt(0);
  const start_surface = find_selectable_surface(range.startContainer);
  const end_surface = find_selectable_surface(range.endContainer);
  if (!start_surface || start_surface.element !== end_surface?.element || !container.contains(start_surface.element)) return undefined;
  const text = selection.toString().trim();
  if (!text) return undefined;
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return undefined;
  return {
    message_id: start_surface.metadata.message_id,
    role: start_surface.metadata.role,
    text,
    viewport_x: Math.min(window.innerWidth - 36, Math.max(36, rect.left + rect.width / 2)),
    viewport_y: Math.max(36, rect.top - 6),
  };
}

/** 向上定位正文节点，并验证 DOM 元数据没有被破坏。 */
function find_selectable_surface(node: Node): { element: HTMLElement; metadata: SelectableMessageSurface } | undefined {
  const element = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>("[data-chat-selectable-message]");
  if (!element) return undefined;
  const message_id = element.dataset.chatMessageId?.trim();
  const role = element.dataset.chatMessageRole;
  if (!message_id || (role !== "user" && role !== "assistant")) return undefined;
  return { element, metadata: { message_id, role } };
}
