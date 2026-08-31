/** Desktop Chat 的 Markdown 渲染入口。 */

import { Markdown } from "@/lib/markdown/Markdown";

/** 使用稳定 Chat 样式渲染静态或流式 Markdown。 */
export function ChatMarkdown({ text, mode, class_name }: { /** Markdown 原文。 */ text: string; /** 渲染模式。 */ mode: "static" | "streaming"; /** 业务附加样式。 */ class_name?: string }) {
  return <Markdown text={text} mode={mode} class_name={`chat-markdown [&>p]:[&>br]:h-0 [&>br]:h-0 [&>hr]:hidden ${class_name || ""}`} />;
}
