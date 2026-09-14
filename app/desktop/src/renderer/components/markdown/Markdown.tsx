/** Desktop 唯一的安全 Markdown 内容渲染器。 */

import "katex/dist/katex.min.css";
import { Streamdown } from "streamdown";
import type { ControlsConfig } from "streamdown";
import { MarkdownStreamingProvider } from "@/components/markdown/markdown_stream_context";
import { markdown_components } from "@/components/markdown/markdown_components";
import { markdown_rehype_plugins, markdown_remark_plugins } from "@/components/markdown/markdown_plugins";
import { normalize_markdown_math } from "@/components/markdown/normalize_markdown_math";
import type { MarkdownProps } from "@/types/Markdown";

/**
 * Markdown 内容仅暴露必要操作：代码可复制，表格不显示导出工具栏。
 *
 * Mermaid 由 Desktop 自己渲染（主题令牌、渲染队列、全屏与导出都在
 * `components/markdown/mermaid/`），这里关掉 Streamdown 的同名能力，避免两套图表实现并存。
 */
const markdown_controls: ControlsConfig = {
  code: true,
  table: false,
  mermaid: false,
};

/**
 * 渲染静态或流式 Markdown。
 *
 * 组件只拥有 Markdown 语义，不识别 Chat、Workspace 或 Plugin。业务容器负责字号、
 * 行高和宽度；HTML 清洗、KaTeX 与 URL 加固交给 Streamdown 默认安全管线维护。
 * 流式状态通过 Context 下传，图表据此决定解析失败时是显示源码还是报错。
 */
export function Markdown({ text, mode }: MarkdownProps) {
  return (
    <MarkdownStreamingProvider value={mode === "streaming"}>
      <Streamdown className="markdown" controls={markdown_controls} components={markdown_components} mode={mode} rehypePlugins={markdown_rehype_plugins} remarkPlugins={markdown_remark_plugins}>
        {normalize_markdown_math(text)}
      </Streamdown>
    </MarkdownStreamingProvider>
  );
}
