/** Desktop Chat 的统一 Streamdown Markdown 渲染器。 */

import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { normalize_markdown_math } from "./markdown_math";

/** 开启常见的 `$...$` 行内公式语法，同时保留 Streamdown 的默认 Markdown 插件。 */
const default_math_plugin = defaultRemarkPlugins.math as [any, ...any[]];
const chat_remark_plugins: NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]> = [
  defaultRemarkPlugins.gfm,
  [default_math_plugin[0], { singleDollarTextMath: true }],
  defaultRemarkPlugins.cjkFriendly,
  defaultRemarkPlugins.cjkFriendlyGfmStrikethrough,
];

/** KaTeX 必须在安全过滤后保留生成节点；harden 已覆盖链接、协议和图片来源安全约束。 */
const chat_rehype_plugins: NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
];

/** 使用稳定 Chat 样式渲染静态或流式 Markdown。 */
export function ChatMarkdown({ text, mode, class_name }: { /** Markdown 原文。 */ text: string; /** 渲染模式。 */ mode: "static" | "streaming"; /** 业务附加样式。 */ class_name?: string }) {
  return <Streamdown className={cn("chat-markdown size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:[&>br]:h-0 [&>br]:h-0 [&>hr]:hidden", class_name)} mode={mode} rehypePlugins={chat_rehype_plugins} remarkPlugins={chat_remark_plugins}>{normalize_markdown_math(text)}</Streamdown>;
}
