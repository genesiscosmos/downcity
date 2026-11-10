/**
 * Markdown 图表的宿主主题订阅。
 *
 * 主题可能声明在文档根或嵌套 ThemeContainer 上；观察实际宿主与各级祖先的主题属性，
 * 将字体和令牌变化转成 React 计数，供布局及 Portal 样式快照更新使用。
 * 只观察祖先节点本身，避免 SVG 更新触发额外渲染。
 */

import { useEffect, useState, type RefObject } from "react";

const observed_attributes = ["class", "data-theme", "data-ui-theme", "data-ui-mode", "style", "data-color-scheme"];

/** 订阅真实宿主及祖先主题；未提供宿主时只观察文档根。 */
export function use_document_theme_revision(host_ref?: RefObject<HTMLElement | null>): number {
  const [revision, set_revision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => set_revision((current) => current + 1));
    let element: HTMLElement | null = host_ref?.current ?? document.documentElement;
    while (element) {
      observer.observe(element, { attributes: true, attributeFilter: observed_attributes });
      element = element.parentElement;
    }
    return () => observer.disconnect();
  }, [host_ref]);

  return revision;
}
