/**
 * Markdown → 图表节点的 rehype 转换。
 *
 * Desktop 的 Mermaid 渲染完全由自己拥有（主题令牌、渲染队列、全屏与导出），而 Streamdown
 * 的 mermaid 分支换不掉：它把渲染 id、并发策略、Loading 文案和缩放控件都封在内部。与其覆盖
 * Streamdown 的代码块组件（那会连带丢掉 shiki 高亮、复制与下载），不如在进入 JSX 之前做一次
 * 语义改写：把 ```mermaid 围栏从「代码」改写成「图表」。代码块与图表在 JSX 里本来就是两种
 * 元素，而 `language-mermaid` 这个 Markdown 事实只在这一层可见。
 *
 * 位置在 sanitize 之后：此时代码块文本已经清洗过，改写出的自定义元素也不会再被
 * `rehype-sanitize` 的默认 schema 当作未知标签丢掉。其余代码块原样保留，继续走 Streamdown。
 */

import type { Element, Root } from "hast";

/** 承载图表源码的自定义元素名；由 `markdown_components` 映射到图表组件。 */
export const mermaid_diagram_tag_name = "mermaid-diagram";

/** Markdown 中声明 Mermaid 的语言类名。 */
const mermaid_language_class_name = "language-mermaid";

/** 读取元素声明的语言类名。 */
function read_language_class_names(element: Element): string[] {
  const class_names = element.properties?.["className"];
  if (!Array.isArray(class_names)) return [];
  return class_names.filter((name): name is string => typeof name === "string");
}

/** 拼接元素的文本子节点。 */
function read_element_text(element: Element): string {
  return element.children.map((child) => (child.type === "text" ? child.value : "")).join("");
}

/** 判断是否为 Mermaid 围栏代码块，是则返回其源码。 */
function read_mermaid_source(element: Element): string | null {
  if (element.tagName !== "pre") return null;

  const code = element.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  if (!code) return null;

  const is_mermaid = read_language_class_names(code).some((name) => name.toLowerCase() === mermaid_language_class_name);
  return is_mermaid ? read_element_text(code) : null;
}

/** 改写单个元素；只有 `pre > code.language-mermaid` 会被替换成图表节点。 */
function rewrite_element(element: Element): Element {
  const source = read_mermaid_source(element);
  if (source !== null) {
    const diagram: Element = {
      type: "element",
      tagName: mermaid_diagram_tag_name,
      properties: {},
      children: [{ type: "text", value: source }],
    };
    if (element.position) diagram.position = element.position;
    return diagram;
  }

  element.children = element.children.map((child) => (child.type === "element" ? rewrite_element(child) : child));
  return element;
}

/** rehype 转换器：把 Mermaid 围栏代码块改写为图表节点。 */
export function rehype_mermaid_blocks(): (tree: Root) => void {
  return (tree) => {
    tree.children = tree.children.map((child) => (child.type === "element" ? rewrite_element(child) : child));
  };
}
