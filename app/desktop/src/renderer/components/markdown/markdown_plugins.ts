/** Desktop Markdown 统一使用的 remark / rehype 管线。 */

import type { ComponentProps } from "react";
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
// 相对路径加显式扩展名：本模块被 node:test 直接加载，`@/` 别名与无扩展名在 Node 侧都无法解析。
import { rehype_mermaid_blocks } from "./rehype_mermaid_blocks.ts";
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
 * Mermaid 改写排在最后：它要把已经清洗过的 `pre > code.language-mermaid` 换成自定义节点，
 * 提前执行会被 sanitize 当作未知标签丢掉。
 */
export const markdown_rehype_plugins: NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
  rehype_mermaid_blocks,
];
