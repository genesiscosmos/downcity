/**
 * Markdown 元素到 React 组件的覆盖表。
 *
 * 这里只覆盖 Desktop 自己拥有的节点，其余元素继续使用 Streamdown 的默认实现（`components`
 * 会与默认表合并）。表必须是模块级常量：Streamdown 用引用相等判断是否需要重新渲染 Markdown
 * 块，每次渲染新建的对象会让整棵内容树失去 memo 边界。
 */

import type { StreamdownProps } from "streamdown";
import { MermaidDiagram } from "@/components/markdown/mermaid/MermaidDiagram";

/**
 * `mermaid-diagram` 由 `rehype_mermaid_blocks` 写入。Streamdown 的 `Components` 类型只声明了
 * HTML 内建标签，自定义元素名不在其中；运行时它按标签名直接查表，因此这里显式放宽类型。
 */
export const markdown_components = {
  "mermaid-diagram": MermaidDiagram,
} as unknown as NonNullable<StreamdownProps["components"]>;
