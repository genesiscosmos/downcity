/** Desktop 唯一的安全 Markdown 内容渲染器。 */

import "katex/dist/katex.min.css";
import { Streamdown } from "streamdown";
import type { ControlsConfig } from "streamdown";
import { markdown_rehype_plugins, markdown_remark_plugins } from "@/components/markdown/markdown_plugins";
import { normalize_markdown_math } from "@/components/markdown/normalize_markdown_math";
import type { MarkdownProps } from "@/types/Markdown";

/** Markdown 内容仅暴露必要操作：代码可复制，表格不显示导出工具栏。 */
const markdown_controls: ControlsConfig = {
  code: true,
  table: false,
  mermaid: true,
};

/**
 * 渲染静态或流式 Markdown。
 *
 * 组件只拥有 Markdown 语义，不识别 Chat、Workspace 或 Plugin。业务容器负责字号、
 * 行高和宽度；HTML 清洗、KaTeX 与 URL 加固交给 Streamdown 默认安全管线维护。
 */
export function Markdown({ text, mode }: MarkdownProps) {
  return <Streamdown className="markdown" controls={markdown_controls} mode={mode} rehypePlugins={markdown_rehype_plugins} remarkPlugins={markdown_remark_plugins}>{normalize_markdown_math(text)}</Streamdown>;
}
