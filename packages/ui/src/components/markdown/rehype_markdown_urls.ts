/**
 * MarkdownView Markdown URL 校验：保留文件路径的原始语义，交由窗口级导航解析。
 *
 * 相对路径不能借助虚拟 origin 转成 HTTP URL，否则会失去所属 Workspace 和行号。
 * HTML 清洗先执行；本插件只允许 MarkdownView 支持的链接协议，并限制图片为网络地址或相对路径。
 * 完整的 HTTP(S) 行内代码地址转换为链接，保留 code 样式；代码块与已有链接不参与转换。
 */

import type { Element, Root } from "hast";

/** 判断链接是否使用受支持的协议；无协议的文件路径和页内锚点直接保留。 */
function is_allowed_url(value: string, is_image: boolean): boolean {
  // 浏览器会忽略 URL 内部分控制字符，必须在协议识别前拒绝它们。
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(value.trim())?.[1]?.toLowerCase();
  return !protocol || protocol === "http" || protocol === "https" || (!is_image && protocol === "file");
}

/** 将完整的 HTTP(S) 行内代码地址包裹为链接；URL 解析仅用于校验，保留原始地址。 */
function link_inline_code(element: Element): Element {
  if (element.tagName !== "code" || element.children.length !== 1) return element;
  const child = element.children[0];
  if (child.type !== "text" || !/^https?:\/\/[^\s]+$/i.test(child.value) || !is_allowed_url(child.value, false)) return element;
  try {
    const url = new URL(child.value);
    if (!url.hostname) return element;
  } catch {
    return element;
  }
  return {
    type: "element",
    tagName: "a",
    properties: { href: child.value, target: "_blank", rel: ["noopener", "noreferrer"] },
    children: [element],
  };
}

/** 校验一个元素及其子元素；危险链接保留可读文字，移除可点击目标。 */
function harden_element(element: Element, skip_inline_links = false): void {
  const is_link = element.tagName === "a";
  const is_image = element.tagName === "img";
  if (is_link || is_image) {
    const attribute = is_link ? "href" : "src";
    const value = element.properties[attribute];
    if (typeof value === "string") {
      if (!is_allowed_url(value, is_image)) {
        delete element.properties[attribute];
      } else if (is_link) {
        element.properties.target = "_blank";
        element.properties.rel = ["noopener", "noreferrer"];
      }
    }
  }
  const skip_children = skip_inline_links || is_link || element.tagName === "pre";
  element.children = element.children.map((child) => {
    if (child.type !== "element") return child;
    harden_element(child, skip_children);
    return skip_children ? child : link_inline_code(child);
  });
}

/** rehype 转换器：检查清洗后的链接与图片 URL，不改写文件路径或追加提示文字。 */
export function rehype_markdown_urls(): (tree: Root) => void {
  return (tree) => {
    for (const child of tree.children) {
      if (child.type === "element") harden_element(child);
    }
  };
}
