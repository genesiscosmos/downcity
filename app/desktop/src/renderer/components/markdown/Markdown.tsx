/** Desktop 唯一的安全 Markdown 内容渲染器。 */

import type { ComponentProps } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import type { ControlsConfig } from "streamdown";
import { normalize_markdown_math } from "@/components/markdown/normalize_markdown_math";
import type { MarkdownProps } from "@/types/Markdown";

/** 开启常见的 `$...$` 行内公式语法，同时保留 Streamdown 的默认 Markdown 插件。 */
const default_math_plugin = defaultRemarkPlugins.math as [any, ...any[]];
const markdown_remark_plugins: NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]> = [
  defaultRemarkPlugins.gfm,
  [default_math_plugin[0], { singleDollarTextMath: true }],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
];

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
  return <Streamdown className="markdown" controls={markdown_controls} mode={mode} remarkPlugins={markdown_remark_plugins}>{normalize_markdown_math(text)}</Streamdown>;
}
