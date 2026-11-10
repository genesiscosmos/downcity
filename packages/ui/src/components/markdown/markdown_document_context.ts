/** Markdown 文档资源上下文：由文件预览提供文档 URL，供图片解析相对资源地址。 */

import { createContext, useContext } from "react";

/** 当前文档的受控本地文件 URL；聊天等没有来源文件的内容不提供基址。 */
export const MarkdownDocumentContext = createContext<string | undefined>(undefined);

/** 读取当前 Markdown 文档的资源基址。 */
export function use_markdown_document_url(): string | undefined {
  return useContext(MarkdownDocumentContext);
}
