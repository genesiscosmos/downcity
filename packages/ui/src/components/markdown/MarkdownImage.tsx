/** Markdown 图片节点：相对文档寻址与宿主资源解析独立于正文排版。 */
import type { ComponentProps } from "react";
import { use_markdown_document_url } from "./markdown_document_context";
import { use_markdown_image_resolver } from "./markdown_host_context";

/** 原始图片地址已由安全管线校验；宿主 resolver 可映射到受控本地资源。 */
export function MarkdownImage({ src, node: _node, ...rest }: ComponentProps<"img"> & {
  /** Markdown 解析树节点，仅供渲染器内部使用，不传递给 DOM。 */
  node?: unknown;
}) {
  const document_url = use_markdown_document_url();
  const resolve_image = use_markdown_image_resolver();
  return <img {...rest} src={typeof src === "string" ? resolve_image(src, document_url) : src} />;
}
