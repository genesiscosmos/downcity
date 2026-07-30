/**
 * UI 模板 MDX 编译与渲染类型。
 *
 * 类型只描述受信任的本地 MDX 文档及构建期 HAST 节点。
 */

import type { MDXContent } from "mdx/types";

/** 构建期使用的最小 HAST 节点。 */
export interface MdxHastNode {
  /** HAST 节点类型，例如 `root`、`element` 或 `text`。 */
  type: string;
  /** element 节点对应的 HTML 标签名。 */
  tagName?: string;
  /** element 节点携带的 HTML/MDX 属性。 */
  properties?: Record<string, unknown>;
  /** 容器节点按源码顺序保存的子节点。 */
  children?: MdxHastNode[];
  /** text 节点保存的原始文本。 */
  value?: string;
}

/** 由 MDX 编译器生成的本地文档组件。 */
export type MdxDocumentComponent = MDXContent;

/** MarkdownDocument 组件属性。 */
export interface MarkdownDocumentProps {
  /** 当前由静态 registry 选中的 MDX 文档组件。 */
  document: MdxDocumentComponent;
}
