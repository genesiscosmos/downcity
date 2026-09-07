/** Desktop 统一 Markdown 内容组件类型。 */

/** Markdown 内容的渲染属性。 */
export interface MarkdownProps {
  /** 需要解析并展示的 Markdown 原文。 */
  text: string;
  /** 静态内容一次渲染，流式内容允许未闭合语法渐进更新。 */
  mode: "static" | "streaming";
}
