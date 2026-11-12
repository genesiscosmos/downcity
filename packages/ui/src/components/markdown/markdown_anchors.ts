/**
 * Markdown 页内导航：为标题生成文档内唯一锚点，并将跳转限制在被点击的阅读器内。
 * 使用 data 属性避免多个 MarkdownView 的同名标题产生全局重复 id。
 */
import type { Element as HastElement, Root } from "hast";
import type { MouseEvent } from "react";

/** 提取标题中的可读文字，包含行内代码、强调与图片替代文字。 */
function heading_text(element: HastElement): string {
  return element.children.map((child) => child.type === "text" ? child.value
    : child.type === "element" ? child.tagName === "img" ? String(child.properties.alt ?? "") : heading_text(child) : "").join("");
}

/** rehype 转换器：为标题生成锚点；重复标题使用递增后缀。 */
export function rehype_markdown_anchors(): (tree: Root) => void {
  return (tree) => {
    const used = new Set<string>();
    const visit = (element: HastElement) => {
      if (/^h[1-6]$/.test(element.tagName)) {
        const base = heading_text(element).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "").replace(/ /g, "-");
        let anchor = base;
        let suffix = 0;
        while (used.has(anchor)) anchor = `${base}-${++suffix}`;
        used.add(anchor);
        element.properties.dataMarkdownAnchor = anchor;
      }
      for (const child of element.children) if (child.type === "element") visit(child);
    };
    for (const child of tree.children) if (child.type === "element") visit(child);
  };
}

/** 消费页内链接；缺失或非法锚点也阻止窗口级导航。 */
export function handle_markdown_anchor_click(event: MouseEvent<HTMLDivElement>): void {
  if (event.defaultPrevented || event.button !== 0) return;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  const href = anchor?.getAttribute("href");
  if (!href?.startsWith("#")) return;
  event.preventDefault();
  let fragment: string;
  try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
  const container = event.currentTarget;
  const target = fragment ? Array.from(container.querySelectorAll<HTMLElement>("[data-markdown-anchor], [id]")).find((element) =>
    element.dataset.markdownAnchor === fragment || element.id === fragment || element.id === `user-content-${fragment}`) : container;
  target?.scrollIntoView({ block: "start" });
}
