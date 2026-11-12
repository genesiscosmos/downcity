/** MarkdownView 统一的 Markdown 解析、HTML 清洗、公式与图表管线。 */

import type { ComponentProps } from "react";
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
import rehype_sanitize, { defaultSchema as default_schema } from "rehype-sanitize";
import { rehype_markdown_urls } from "./rehype_markdown_urls.ts";
import { rehype_markdown_anchors } from "./markdown_anchors.ts";
// 纯函数模块使用显式扩展名，支持构建器与 Node 源码检查直接加载。
import { rehype_mermaid_blocks } from "./rehype_mermaid_blocks.ts";
import { rehype_svg_blocks } from "./rehype_svg_blocks.ts";
import { remark_gfm_without_autolink } from "./remark_gfm_without_autolink.ts";

/** 开启常见的 `$...$` 行内公式语法，同时保留 Streamdown 的默认 Markdown 插件。 */
const default_math_plugin = defaultRemarkPlugins.math as [any, ...any[]];
export const markdown_remark_plugins: NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]> = [
  remark_gfm_without_autolink,
  [default_math_plugin[0], { singleDollarTextMath: true }],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
];

/**
 * Streamdown 默认先执行 KaTeX、再执行 sanitize，会清除 KaTeX 生成的 class，令公式
 * 退化为无样式的 MathML/HTML。先清理输入 HTML，再生成可信公式节点，最后加固 URL。
 *
 * Mermaid 与 SVG 改写排在最后：将已清洗的围栏代码块转换为自定义预览节点，
 * 提前执行会被 sanitize 当作未知标签丢掉。
 */
const default_katex_plugin = defaultRehypePlugins.katex as [any, ...any[]];
export const markdown_rehype_plugins: NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  [rehype_sanitize, {
    ...default_schema,
    protocols: {
      ...default_schema.protocols,
      href: ["http", "https", "file"],
    },
  }],
  // 公式统一移除 boxed 盒子装饰，保持阅读节奏。
  [default_katex_plugin[0], {
    ...default_katex_plugin[1],
    macros: { "\\boxed": "{#1}" },
  }],
  rehype_markdown_urls,
  rehype_markdown_anchors,
  rehype_mermaid_blocks,
  rehype_svg_blocks,
];
