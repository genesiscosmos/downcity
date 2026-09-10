/** Desktop Chat 共用的自动跟随、动态高度与历史前插滚动控制。 */

import { useCallback, useEffect, useLayoutEffect, useRef, type UIEvent } from "react";
import type { ChatPrependAnchor } from "@/types/ChatScroll";
import { is_chat_scroll_sticky, resolve_chat_anchor_scroll_top } from "@/features/chat/lib/chat_scroll";

/** 消息视口行用于历史前插锚定的 DOM 属性。 */
const viewport_row_selector = "[data-chat-viewport-row]";

/** 统一持有 Chat 消息滚动面板的生命周期与滚动策略。 */
export function use_chat_scroll(surface_id: string, auto_scroll: boolean) {
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const content_ref = useRef<HTMLDivElement | null>(null);
  const bottom_ref = useRef<HTMLDivElement | null>(null);
  const sticky_ref = useRef(true);
  const last_scroll_top_ref = useRef(0);
  const preserving_ref = useRef(false);
  const auto_scroll_ref = useRef(auto_scroll);
  const surface_id_ref = useRef(surface_id);
  const follow_frame_ref = useRef<number | undefined>(undefined);
  const anchor_frame_ref = useRef<number | undefined>(undefined);
  auto_scroll_ref.current = auto_scroll;
  surface_id_ref.current = surface_id;

  /** 立即将专用底部锚点对齐到视口底部。 */
  const align_bottom_anchor = useCallback(() => {
    const container = scroll_ref.current;
    const bottom = bottom_ref.current;
    if (!container || !bottom || preserving_ref.current) return;
    bottom.scrollIntoView({ block: "end" });
    sticky_ref.current = true;
    last_scroll_top_ref.current = container.scrollTop;
  }, []);

  /** 仅在用户仍位于底部且启用了自动跟随时响应内容增长。 */
  const schedule_scroll_to_bottom = useCallback(() => {
    if (!auto_scroll_ref.current || !sticky_ref.current || preserving_ref.current) return;
    if (follow_frame_ref.current !== undefined) window.cancelAnimationFrame(follow_frame_ref.current);
    const target_surface_id = surface_id_ref.current;
    follow_frame_ref.current = window.requestAnimationFrame(() => {
      follow_frame_ref.current = undefined;
      // ResizeObserver 排队后用户可能已经向上滚动；执行前必须再次确认跟随资格。
      if (
        surface_id_ref.current === target_surface_id
        && auto_scroll_ref.current
        && sticky_ref.current
        && !preserving_ref.current
      ) align_bottom_anchor();
    });
  }, [align_bottom_anchor]);

  useLayoutEffect(() => {
    if (follow_frame_ref.current !== undefined) window.cancelAnimationFrame(follow_frame_ref.current);
    if (anchor_frame_ref.current !== undefined) window.cancelAnimationFrame(anchor_frame_ref.current);
    follow_frame_ref.current = undefined;
    anchor_frame_ref.current = undefined;
    sticky_ref.current = true;
    last_scroll_top_ref.current = 0;
    preserving_ref.current = false;
    align_bottom_anchor();
  }, [align_bottom_anchor, surface_id]);

  useEffect(() => {
    if (auto_scroll) schedule_scroll_to_bottom();
  }, [auto_scroll, schedule_scroll_to_bottom]);

  useEffect(() => {
    const content = content_ref.current;
    if (!content) return;
    const resize_observer = new ResizeObserver(schedule_scroll_to_bottom);
    resize_observer.observe(content);
    return () => resize_observer.disconnect();
  }, [schedule_scroll_to_bottom, surface_id]);

  useEffect(() => () => {
    if (follow_frame_ref.current !== undefined) window.cancelAnimationFrame(follow_frame_ref.current);
    if (anchor_frame_ref.current !== undefined) window.cancelAnimationFrame(anchor_frame_ref.current);
  }, []);

  const handle_scroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const moved_up = container.scrollTop < last_scroll_top_ref.current;
    last_scroll_top_ref.current = container.scrollTop;
    // 用户一旦向上浏览便立即退出跟随，即使仍落在底部容差范围内。
    sticky_ref.current = moved_up ? false : is_chat_scroll_sticky({
      scroll_height: container.scrollHeight,
      scroll_top: container.scrollTop,
      client_height: container.clientHeight,
    });
    if (!sticky_ref.current && follow_frame_ref.current !== undefined) {
      window.cancelAnimationFrame(follow_frame_ref.current);
      follow_frame_ref.current = undefined;
    }
  }, []);

  const preserve_prepend_position = useCallback(async (load_earlier: () => Promise<void>) => {
    const container = scroll_ref.current;
    const anchor = container ? capture_prepend_anchor(container) : undefined;
    const target_surface_id = surface_id_ref.current;
    preserving_ref.current = true;
    try {
      await load_earlier();
    } catch (error) {
      preserving_ref.current = false;
      throw error;
    }
    if (surface_id_ref.current !== target_surface_id) {
      preserving_ref.current = false;
      return;
    }
    if (anchor_frame_ref.current !== undefined) window.cancelAnimationFrame(anchor_frame_ref.current);
    anchor_frame_ref.current = window.requestAnimationFrame(() => {
      anchor_frame_ref.current = undefined;
      const current_container = scroll_ref.current;
      if (current_container && anchor) restore_prepend_anchor(current_container, anchor);
      preserving_ref.current = false;
    });
  }, []);

  return { scroll_ref, content_ref, bottom_ref, handle_scroll, preserve_prepend_position };
}

/** 捕获当前首个可见消息行，避免历史前插依赖整体内容高度。 */
function capture_prepend_anchor(container: HTMLDivElement): ChatPrependAnchor {
  const container_top = container.getBoundingClientRect().top;
  const rows = container.querySelectorAll<HTMLElement>(viewport_row_selector);
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom >= container_top) {
      return {
        row_id: row.dataset.chatViewportRow || "",
        viewport_offset: rect.top - container_top,
        scroll_height: container.scrollHeight,
        scroll_top: container.scrollTop,
      };
    }
  }
  return { row_id: "", viewport_offset: 0, scroll_height: container.scrollHeight, scroll_top: container.scrollTop };
}

/** 历史消息提交到 DOM 后恢复同一可见消息在视口内的位置。 */
function restore_prepend_anchor(container: HTMLDivElement, anchor: ChatPrependAnchor): void {
  const rows = container.querySelectorAll<HTMLElement>(viewport_row_selector);
  const row = Array.from(rows).find((candidate) => candidate.dataset.chatViewportRow === anchor.row_id);
  if (row && anchor.row_id) {
    const current_offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = resolve_chat_anchor_scroll_top(container.scrollTop, anchor.viewport_offset, current_offset);
    return;
  }
  container.scrollTop = Math.max(0, anchor.scroll_top + container.scrollHeight - anchor.scroll_height);
}
