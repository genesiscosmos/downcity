/**
 * UI 展示页 MDX 文档渲染器。
 *
 * 渲染器只接收静态注册的受信任 MDX 组件，并注入统一组件映射。
 */

import { mdx_components } from "../mdx/components.js";
import type { MarkdownDocumentProps } from "../types/mdx.js";

/** 渲染单份可信本地 MDX 组件文档。 */
export function MarkdownDocument({ document: Document }: MarkdownDocumentProps) {
  return (
    <article className="mdx-content mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Document components={mdx_components} />
    </article>
  );
}
