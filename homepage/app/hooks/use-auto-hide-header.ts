/**
 * 全局 Header 的滚动方向显隐状态。
 *
 * Hook 只读取页面滚动方向：向下滚动一段距离后隐藏，向上滚动时更快显示，
 * 页面接近顶部时始终显示。方向累计用于过滤触控板与惯性滚动产生的细小抖动。
 */

import { useEffect, useRef, useState } from "react";

const top_reveal_distance = 12;
const hide_direction_distance = 18;
const reveal_direction_distance = 6;
const minimum_scroll_delta = 0.5;

/** 返回 Header 当前是否可见，以及页面是否已经离开顶部。 */
export function use_auto_hide_header() {
  const [header_visible, set_header_visible] = useState(true);
  const [scrolled, set_scrolled] = useState(false);
  const previous_scroll_y_ref = useRef(0);
  const direction_distance_ref = useRef(0);

  useEffect(() => {
    /** 根据真实页面位置累计单一方向的滚动距离。 */
    const handle_scroll = () => {
      const current_scroll_y = Math.max(0, window.scrollY);
      const scroll_delta = current_scroll_y - previous_scroll_y_ref.current;
      previous_scroll_y_ref.current = current_scroll_y;
      set_scrolled(current_scroll_y > 0);

      if (current_scroll_y <= top_reveal_distance) {
        direction_distance_ref.current = 0;
        set_header_visible(true);
        return;
      }

      if (Math.abs(scroll_delta) < minimum_scroll_delta) return;

      if (scroll_delta > 0) {
        direction_distance_ref.current = Math.max(0, direction_distance_ref.current) + scroll_delta;
        if (direction_distance_ref.current >= hide_direction_distance) set_header_visible(false);
        return;
      }

      direction_distance_ref.current = Math.min(0, direction_distance_ref.current) + scroll_delta;
      if (direction_distance_ref.current <= -reveal_direction_distance) set_header_visible(true);
    };

    previous_scroll_y_ref.current = Math.max(0, window.scrollY);
    handle_scroll();
    window.addEventListener("scroll", handle_scroll, { passive: true });
    return () => window.removeEventListener("scroll", handle_scroll);
  }, []);

  return { header_visible, scrolled };
}
