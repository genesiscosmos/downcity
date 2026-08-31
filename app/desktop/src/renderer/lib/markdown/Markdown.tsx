/** Desktop 通用的安全 Markdown 渲染器。 */

import type { ComponentProps } from "react";
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { normalize_markdown_math } from "./normalize_markdown_math";

/** 开启常见的 `$...$` 行内公式语法，同时保留 Streamdown 的默认 Markdown 插件。 */
const default_math_plugin = defaultRemarkPlugins.math as [any, ...any[]];
const markdown_remark_plugins: NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]> = [
  defaultRemarkPlugins.gfm,
  [default_math_plugin[0], { singleDollarTextMath: true }],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
];

/** KaTeX 必须在安全过滤后保留生成节点；harden 统一约束链接、协议和图片来源。 */
const markdown_rehype_plugins: NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
];

/** 渲染静态或流式 Markdown；不会编译或执行 MDX 中的 JavaScript 与组件。 */
export function Markdown({ text, mode, class_name }: { /** Markdown 原文。 */ text: string; /** 渲染模式。 */ mode: "static" | "streaming"; /** 业务附加样式。 */ class_name?: string }) {
  return <Streamdown className={cn("markdown-content size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", class_name)} mode={mode} rehypePlugins={markdown_rehype_plugins} remarkPlugins={markdown_remark_plugins}>{normalize_markdown_math(text)}</Streamdown>;
}
