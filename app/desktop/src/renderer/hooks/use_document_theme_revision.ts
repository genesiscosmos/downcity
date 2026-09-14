/**
 * 文档主题变更计数。
 *
 * 外观设置写在 `<html>` 的 `data-theme` 与 `dark` 类名上，不是 React 状态。图表这类把具体
 * 颜色写进渲染结果的内容不会因为主题切换而重渲染，于是留在旧配色上——切到深色后仍是一张浅色
 * 图。这个钩子把文档级主题变化转成组件可以依赖的计数，订阅者重新渲染即可重新读取令牌。
 *
 * 只观察 `class` 与 `data-theme`：界面缩放（`style.fontSize`）不改变图表内部的像素布局。
 */

import { useEffect, useState } from "react";

const observed_attributes = ["class", "data-theme"];

/** 订阅文档主题变化，返回随每次变化递增的计数。 */
export function use_document_theme_revision(): number {
  const [revision, set_revision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => set_revision((current) => current + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: observed_attributes });
    return () => observer.disconnect();
  }, []);

  return revision;
}
