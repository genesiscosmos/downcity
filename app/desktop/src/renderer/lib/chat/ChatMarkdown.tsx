/** Desktop Chat 的统一 Streamdown Markdown 渲染器。 */

import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/** 使用稳定 Chat 样式渲染静态或流式 Markdown。 */
export function ChatMarkdown({ text, mode, class_name }: { /** Markdown 原文。 */ text: string; /** 渲染模式。 */ mode: "static" | "streaming"; /** 业务附加样式。 */ class_name?: string }) {
  return <Streamdown className={cn("chat-markdown size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:[&>br]:h-0 [&>br]:h-0 [&>hr]:hidden", class_name)} mode={mode}>{text}</Streamdown>;
}
