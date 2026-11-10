/** 静态导出渲染上下文：离屏文档需要立即生成图表，不能等待进入滚动视口。 */
import { createContext, useContext } from "react";

/** 仅导出文档的独立 React 树启用，不影响正常聊天中的懒加载。 */
export const MarkdownExportContext = createContext(false);

/** 读取当前 Markdown 是否正在生成静态归档。 */
export function use_markdown_export(): boolean {
  return useContext(MarkdownExportContext);
}
