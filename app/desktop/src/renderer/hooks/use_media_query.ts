/** 媒体查询订阅：把窗口宽度变化暴露成 React 状态。 */

import { useEffect, useState } from "react";

/**
 * 订阅一个媒体查询并返回当前是否命中。
 *
 * 用 matchMedia 而不是 window.innerWidth + resize 监听：
 * matchMedia 只在**跨越**断点时回调，不会在拖动窗口时每像素触发一次重渲染。
 */
export function use_media_query(query: string): boolean {
  const [matches, set_matches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const media_query = window.matchMedia(query);
    const apply = (next: boolean) => set_matches(next);
    apply(media_query.matches);
    media_query.addEventListener("change", (event) => apply(event.matches));
    return () => media_query.removeEventListener("change", (event) => apply(event.matches));
  }, [query]);

  return matches;
}
