/**
 * UI 模板 MDX 组件映射。
 *
 * 映射统一 Markdown 的排版、表格、链接、代码块和交互 Demo，
 * 文档内容不直接持有页面布局实现。
 */

import {
  Anchor,
  Annotation,
  Blockquote,
  CodeBlock,
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  Emphasis,
  FootnoteItem,
  FootnoteReference,
  Footnotes,
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  Hr,
  ListItem,
  OrderedList,
  Paragraph,
  Strong,
  TaskListItem,
  UnorderedList,
} from "@downcity/ui";
import type { MDXComponents } from "mdx/types";
import type * as React from "react";

import { ComponentDemo } from "../components/component-preview.js";

/** 为 Markdown 表格提供独立横向滚动边界。 */
function MdxTable(props: React.ComponentProps<"table">) {
  return (
    <div className="mdx-table-scroll">
      <table {...props} />
    </div>
  );
}

export const mdx_components: MDXComponents = {
  a: Anchor,
  blockquote: Blockquote,
  em: Emphasis,
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  h5: H5,
  h6: H6,
  hr: Hr,
  li: ListItem,
  ol: OrderedList,
  p: Paragraph,
  pre: CodeBlock,
  strong: Strong,
  table: MdxTable,
  ul: UnorderedList,
  Annotation,
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  FootnoteItem,
  FootnoteReference,
  Footnotes,
  TaskListItem,
  ComponentDemo,
};
