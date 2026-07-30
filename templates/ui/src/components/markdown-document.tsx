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
    <article className="mdx-content mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Document components={mdx_components} />
    </article>
  );
}
