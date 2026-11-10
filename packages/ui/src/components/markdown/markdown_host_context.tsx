/** MarkdownView 的应用级宿主能力；默认实现可独立用于浏览器和服务端渲染。 */
import { createContext, useContext, useMemo } from "react";
import type { MarkdownViewProviderProps } from "./markdown_view_types";
import { normalize_markdown_text_size, type MarkdownViewTextSize } from "./markdown_text_size";

/** 默认辅助文案；宿主只替换文本，不改变图表行为和样式。 */
const default_labels: Readonly<Record<string, string>> = {
  "mermaid.diagram": "Mermaid diagram",
  "mermaid.rendering": "Rendering diagram…",
  "mermaid.render_failed": "Unable to render this diagram",
  "mermaid.retry": "Retry",
  "mermaid.copy_source": "Copy Mermaid source",
  "mermaid.copied": "Copied",
  "mermaid.fullscreen": "View fullscreen",
  "mermaid.exit_fullscreen": "Exit fullscreen",
  "mermaid.download_png": "Download as PNG",
  "mermaid.download_failed": "Unable to export the diagram",
  "mermaid.zoom_in": "Zoom in",
  "mermaid.zoom_out": "Zoom out",
  "mermaid.fit": "Fit to view",
};

/** 仅解析网页图片；本地受控协议由应用级 resolver 提供。 */
function resolve_image_src(src: string, document_url?: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/.test(src)) return undefined;
  try {
    const url = document_url ? new URL(src, document_url) : new URL(src);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return /^[a-z][a-z\d+.-]*:/i.test(src.trim()) ? undefined : src;
  }
}

/** 未配置翻译时也提供完整的无障碍操作名称。 */
function translate(key: string): string {
  return default_labels[key] ?? key;
}

/** 平台能力和受控字号共享同一继承边界；内容、流式与导出仍由各自上下文持有。 */
const markdown_host_context = createContext({ resolve_image_src, translate, text_size: "medium" as MarkdownViewTextSize });

/** 应用根接入平台能力，对话范围只需选择字号，其他未指定能力继续继承。 */
export function MarkdownViewProvider({ children, text_size, resolve_image_src: resolve_image, translate: translate_label }: MarkdownViewProviderProps) {
  const parent = useContext(markdown_host_context);
  const value = useMemo(() => ({
    resolve_image_src: resolve_image ?? parent.resolve_image_src,
    translate: translate_label ?? parent.translate,
    text_size: normalize_markdown_text_size(text_size ?? parent.text_size),
  }), [resolve_image, translate_label, text_size, parent]);
  return <markdown_host_context.Provider value={value}>{children}</markdown_host_context.Provider>;
}

/** 嵌入式阅读内容读取当前范围的受控字号档位。 */
export function use_markdown_text_size(): MarkdownViewTextSize {
  return useContext(markdown_host_context).text_size;
}

/** 图片节点读取当前应用的资源解析能力。 */
export function use_markdown_image_resolver() {
  return useContext(markdown_host_context).resolve_image_src;
}

/** 图表操作读取当前应用的辅助文案。 */
export function use_markdown_translation() {
  return useContext(markdown_host_context).translate;
}
