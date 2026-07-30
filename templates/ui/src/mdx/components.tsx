/**
 * UI 模板 MDX 组件映射。
 *
 * 映射统一 Markdown 的排版、表格、链接、代码块和交互 Demo，
 * 文档内容不直接持有页面布局实现。
 */

import { CodeBlock } from "@downcity/ui";
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
  pre: CodeBlock,
  table: MdxTable,
  ComponentDemo,
};
