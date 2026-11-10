/**
 * 将 SVG 围栏代码块转换为受控图片节点。
 * 在 sanitize 之后运行，源码保持为文本，由 SvgDiagram 在图片上下文中隔离加载。
 */

import type { Element, Root } from "hast";

/** 改写 SVG 代码块，并递归处理引用、列表等容器中的围栏。 */
function rewrite_element(element: Element): Element {
  if (element.tagName === "pre") {
    const code = element.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
    const class_names = code?.properties.className;
    if (code && Array.isArray(class_names) && class_names.some((name) => String(name).toLowerCase() === "language-svg")) {
      return {
        type: "element",
        tagName: "svg-diagram",
        properties: {},
        children: [{ type: "text", value: code.children.map((child) => child.type === "text" ? child.value : "").join("") }],
        position: element.position,
      };
    }
  }
  element.children = element.children.map((child) => child.type === "element" ? rewrite_element(child) : child);
  return element;
}

/** rehype 插件：只转换 language-svg，其他代码块继续使用默认渲染器。 */
export function rehype_svg_blocks(): (tree: Root) => void {
  return (tree) => {
    tree.children = tree.children.map((child) => child.type === "element" ? rewrite_element(child) : child);
  };
}
