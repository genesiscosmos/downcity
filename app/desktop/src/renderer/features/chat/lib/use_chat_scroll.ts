/**
 * Desktop Chat 共用的自动跟随、动态高度与历史前插滚动控制。
 *
 * 三条不变量，改动前请先读完：
 *
 * 1. **视口上方的高度变化必须被补偿。** 消息行不做离屏布局跳过（原因见
 *    `styles/chat.css`），并保留浏览器原生滚动锚定；用户向上浏览时，锚定是
 *    唯一能自动补偿「视口上方内容变高」的机制，不能关。
 * 2. **历史前插的恢复必须与 React 提交同步。** Store 更新到 DOM 提交之间隔着
 *    React 调度，任何「await 之后再补一帧」的写法都可能跑在旧 DOM 上，等于没有恢复。
 *    恢复点由 `content_key` 变化触发的 layout effect 承担。
 * 3. **程序化滚动与用户滚动必须可区分。** 本 hook 写入的 scrollTop 一律登记，
 *    随后触发的 scroll 事件不得被解释为「用户向上浏览」。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import type { ChatPrependAnchor } from "@/types/ChatScroll";
import {
  is_chat_scroll_sticky,
  is_chat_scroll_up_intent,
  is_programmatic_scroll_top,
  resolve_chat_anchor_scroll_top,
} from "@/features/chat/lib/chat_scroll";

/** 消息视口行用于历史前插锚定的 DOM 属性。 */
const viewport_row_selector = "[data-chat-viewport-row]";

/**
 * 统一持有 Chat 消息滚动面板的生命周期与滚动策略。
 *
 * @param surface_id 滚动面板稳定标识；变化时重置跟随状态并重新定位到底部。
 * @param auto_scroll 是否在贴近底部时跟随流式内容增长。
 * @param content_key 内容头部标识（当前首条消息 ID）。仅在历史前插时变化，
 *   用于在 DOM 提交后同步恢复锚点；Group 只追加消息，因此传常量。
 */
export function use_chat_scroll(surface_id: string, auto_scroll: boolean, content_key: string) {
  const scroll_ref = useRef<HTMLDivElement | null>(null);
  const content_ref = useRef<HTMLDivElement | null>(null);
  const sticky_ref = useRef(true);
  const last_scroll_top_ref = useRef(0);
  /** 本 hook 最近一次写入的 scrollTop，用于排除自触发事件。 */
  const programmatic_top_ref = useRef<number | undefined>(undefined);
  /** 历史前插前捕获的锚点，由 layout effect 消费。 */
  const pending_anchor_ref = useRef<ChatPrependAnchor | undefined>(undefined);
  const preserving_ref = useRef(false);
  const auto_scroll_ref = useRef(auto_scroll);
  const surface_id_ref = useRef(surface_id);
  const follow_frame_ref = useRef<number | undefined>(undefined);
  /** 前插保护解除的傅底帧，用于在 Session 切换时取消。 */
  const anchor_frame_ref = useRef<number | undefined>(undefined);
  // 跟随状态要驱动界面（「回到最新」入口），因此除了 ref 还需要一份 state；
  // 两者始终同步，ref 供滚动回调用（不能读到过期 state），state 供渲染用。
  const [is_following, set_is_following] = useState(true);
  auto_scroll_ref.current = auto_scroll;
  surface_id_ref.current = surface_id;

  /** 同步跟随状态；同值时 React 会自动跳过重渲染，滚动事件里可放心调用。 */
  const sync_following = useCallback((next: boolean) => {
    sticky_ref.current = next;
    set_is_following(next);
  }, []);

  /** 读取当前滚动几何，供跟随判定复用。 */
  const read_metrics = useCallback((container: HTMLDivElement) => ({
    scroll_height: container.scrollHeight,
    scroll_top: container.scrollTop,
    client_height: container.clientHeight,
  }), []);

  /**
   * 写入 scrollTop 并登记，避免随后触发的 scroll 事件被当成用户操作。
   *
   * 位置没有实际变化时不登记：浏览器不会为它派发 scroll 事件，登记下来的值
   * 会一直存活到下一次滚动，从而误吞用户那一次真实操作。
   */
  const write_scroll_top = useCallback((container: HTMLDivElement, next_top: number) => {
    if (container.scrollTop === next_top) return;
    container.scrollTop = next_top;
    programmatic_top_ref.current = container.scrollTop;
  }, []);

  /**
   * 立即把视口对齐到底部。
   *
   * 直接写 scrollTop 而不是 `scrollIntoView`：后者会连带滚动所有可滚动祖先，
   * 让外层布局一起位移。
   */
  const pin_to_bottom = useCallback(() => {
    const container = scroll_ref.current;
    if (!container || preserving_ref.current) return;
    write_scroll_top(container, Math.max(0, container.scrollHeight - container.clientHeight));
    sticky_ref.current = true;
    last_scroll_top_ref.current = container.scrollTop;
    set_is_following(true);
  }, [write_scroll_top]);

  /** 仅在用户仍位于底部且启用了自动跟随时响应内容增长。 */
  const schedule_scroll_to_bottom = useCallback(() => {
    if (!auto_scroll_ref.current || !sticky_ref.current || preserving_ref.current) return;
    if (!scroll_ref.current) return;
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
      ) pin_to_bottom();
    });
  }, [pin_to_bottom]);

  useLayoutEffect(() => {
    if (follow_frame_ref.current !== undefined) window.cancelAnimationFrame(follow_frame_ref.current);
    if (anchor_frame_ref.current !== undefined) window.cancelAnimationFrame(anchor_frame_ref.current);
    follow_frame_ref.current = undefined;
    anchor_frame_ref.current = undefined;
    sticky_ref.current = true;
    set_is_following(true);
    last_scroll_top_ref.current = 0;
    programmatic_top_ref.current = undefined;
    pending_anchor_ref.current = undefined;
    preserving_ref.current = false;
    pin_to_bottom();
  }, [pin_to_bottom, surface_id]);

  /**
   * 历史前插的恢复点。
   *
   * layout effect 在 DOM 提交后、浏览器绘制前运行，因此恢复不会「先闪一下再跳回来」。
   * 浏览器锚定若已补偿同一位移，这里算出的修正量接近 0，不会叠加两次。
   */
  useLayoutEffect(() => {
    if (!preserving_ref.current) return;
    const container = scroll_ref.current;
    const anchor = pending_anchor_ref.current;
    pending_anchor_ref.current = undefined;
    preserving_ref.current = false;
    if (!container) return;
    if (anchor) restore_prepend_anchor(container, anchor, write_scroll_top);
    last_scroll_top_ref.current = container.scrollTop;
    // 恢复后重新按真实位置判定跟随：仍在底部就继续跟随，停在中段就交回用户。
    sync_following(is_chat_scroll_sticky(read_metrics(container)));
  }, [content_key, read_metrics, sync_following, write_scroll_top]);

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
    const next_top = container.scrollTop;
    const previous_top = last_scroll_top_ref.current;
    const own_write = is_programmatic_scroll_top(programmatic_top_ref.current, next_top);
    programmatic_top_ref.current = undefined;
    last_scroll_top_ref.current = next_top;
    // 本 hook 自己写入的位置不代表用户意图；前插恢复期间同理。
    if (own_write || preserving_ref.current) return;
    // 用户一旦向上浏览便立即退出跟随，即使仍落在底部容差范围内。
    sync_following(!is_chat_scroll_up_intent(previous_top, next_top) && is_chat_scroll_sticky(read_metrics(container)));
    if (!sticky_ref.current && follow_frame_ref.current !== undefined) {
      window.cancelAnimationFrame(follow_frame_ref.current);
      follow_frame_ref.current = undefined;
    }
  }, [read_metrics, sync_following]);

  /**
   * 在历史前插前后保持同一条消息在视口内的位置。
   *
   * 这里只捕获锚点并置位，不等待、也不自行恢复：真正的恢复交给 `content_key`
   * 变化后的 layout effect，避免和 React 的提交时序抢跑。
   */
  const preserve_prepend_position = useCallback(async (load_earlier: () => Promise<void>) => {
    const container = scroll_ref.current;
    const target_surface_id = surface_id_ref.current;
    pending_anchor_ref.current = container ? capture_prepend_anchor(container) : undefined;
    preserving_ref.current = true;
    try {
      await load_earlier();
    } catch (error) {
      pending_anchor_ref.current = undefined;
      preserving_ref.current = false;
      throw error;
    }
    if (surface_id_ref.current !== target_surface_id) {
      pending_anchor_ref.current = undefined;
      preserving_ref.current = false;
      return;
    }
    // 兜底：本次分页没有带来新内容（空页或全部重复）时 layout effect 不会触发，
    // 必须自己解除保护，否则自动跟随会被永久抑制。React 的提交早于动画帧，
    // 正常路径下锚点已经在这一帧之前被消费。
    if (anchor_frame_ref.current !== undefined) window.cancelAnimationFrame(anchor_frame_ref.current);
    anchor_frame_ref.current = window.requestAnimationFrame(() => {
      anchor_frame_ref.current = undefined;
      if (!preserving_ref.current || surface_id_ref.current !== target_surface_id) return;
      pending_anchor_ref.current = undefined;
      preserving_ref.current = false;
    });
  }, []);

  return { scroll_ref, content_ref, handle_scroll, preserve_prepend_position, is_following, scroll_to_bottom: pin_to_bottom };
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
function restore_prepend_anchor(
  container: HTMLDivElement,
  anchor: ChatPrependAnchor,
  write_scroll_top: (container: HTMLDivElement, next_top: number) => void,
): void {
  const rows = container.querySelectorAll<HTMLElement>(viewport_row_selector);
  const row = Array.from(rows).find((candidate) => candidate.dataset.chatViewportRow === anchor.row_id);
  if (row && anchor.row_id) {
    const current_offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    write_scroll_top(container, resolve_chat_anchor_scroll_top(container.scrollTop, anchor.viewport_offset, current_offset));
    return;
  }
  write_scroll_top(container, Math.max(0, anchor.scroll_top + container.scrollHeight - anchor.scroll_height));
}
