/** Desktop Markdown 统一使用的 remark / rehype 管线。 */

import type { ComponentProps } from "react";
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";

/** 开启常见的 `$...$` 行内公式语法，同时保留 Streamdown 的默认 Markdown 插件。 */
const default_math_plugin = defaultRemarkPlugins.math as [any, ...any[]];
export const markdown_remark_plugins: NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]> = [
  defaultRemarkPlugins.gfm,
  [default_math_plugin[0], { singleDollarTextMath: true }],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
];

/**
 * Streamdown 默认先执行 KaTeX、再执行 sanitize，会清除 KaTeX 生成的 class，令公式
 * 退化为无样式的 MathML/HTML。先清理输入 HTML，再生成可信公式节点，最后加固 URL。
 */
export const markdown_rehype_plugins: NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
];
