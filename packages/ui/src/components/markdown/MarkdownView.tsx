/**
 * 统一 Markdown 阅读组件：拥有渲染、主题排版与阅读布局。
 * 业务不能注入插件或任意字体样式；平台能力与受控字号档位由 MarkdownViewProvider 接入。
 */
import { memo, useMemo, type CSSProperties } from "react";
import { Streamdown, type ControlsConfig } from "streamdown";
import { cn } from "../../lib/utils";
import { MarkdownStreamingProvider } from "./markdown_stream_context";
import { MarkdownDocumentContext } from "./markdown_document_context";
import { use_markdown_export } from "./markdown_export_context";
import { markdown_components } from "./markdown_components";
import { markdown_rehype_plugins, markdown_remark_plugins } from "./markdown_plugins";
import { exceeds_markdown_limits } from "./markdown_render_limits";
import { normalize_markdown_math } from "./normalize_markdown_math";
import type { MarkdownViewProps } from "./markdown_view_types";
import { use_markdown_text_size } from "./markdown_host_context";
import { get_markdown_text_size } from "./markdown_text_size";

/** 图表由组件自有实现管理；代码保留复制，表格不生成导出工具栏。 */
const markdown_controls: ControlsConfig = { code: true, table: false, mermaid: false };

/** 静态与流式内容使用同一排版；超限文本安全降级仍保留阅读布局。 */
export const MarkdownView = memo(function markdown_view({ text, mode = "static", layout = "document", document_url, class_name }: MarkdownViewProps) {
  const export_mode = use_markdown_export();
  const inherited_size = use_markdown_text_size();
  const text_size = layout === "embedded" && !export_mode ? inherited_size : "medium";
  // Streamdown 的 memo 只比较原文和渲染模式；字号写在自有布局节点，保证纯设置更新即时生效。
  const layout_style = { "--markdown-text-size": get_markdown_text_size(text_size) } as CSSProperties;
  const prepared = useMemo(() => {
    const plain = exceeds_markdown_limits(text);
    return { plain, text: plain ? text : normalize_markdown_math(text) };
  }, [text]);

  return <div className={cn("markdown-view-layout", class_name)} style={layout_style} data-markdown-layout={layout} data-markdown-export={export_mode ? "" : undefined}>
    <MarkdownDocumentContext.Provider value={document_url}>
      <MarkdownStreamingProvider value={!prepared.plain && mode === "streaming"}>
        {prepared.plain ? <div className="markdown-view markdown-view-plain" data-markdown-fallback="plain">{prepared.text}</div> :
          <Streamdown className="markdown-view" controls={markdown_controls} components={markdown_components} mode={mode} rehypePlugins={markdown_rehype_plugins} remarkPlugins={markdown_remark_plugins}>
            {prepared.text}
          </Streamdown>}
      </MarkdownStreamingProvider>
    </MarkdownDocumentContext.Provider>
  </div>;
});
