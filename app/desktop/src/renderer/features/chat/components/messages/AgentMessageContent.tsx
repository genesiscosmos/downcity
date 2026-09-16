/** Agent Message 单层展示投影的内容渲染器。 */

import type { RespondSessionInteractionInput } from "@downcity/agent";
import { TbAlertTriangle, TbFile } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { AgentActivity } from "@/features/chat/components/messages/AgentActivity";
import { TurnFileDiffCard } from "@/features/chat/components/messages/TurnFileDiffCard";
import { chat_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import type { AgentMessageBlock } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 按 canonical 顺序渲染一条 Agent Message 的全部可见 Block。 */
export function AgentMessageContent({ message_id, blocks, show_reasoning, streaming, respond_interaction }: { /** canonical Agent Message 标识。 */ message_id: string; /** 已投影的单层展示 Block。 */ blocks: readonly AgentMessageBlock[]; /** 是否展示 Reasoning。 */ show_reasoning: boolean; /** 当前消息是否流式生成。 */ streaming: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  return <>{blocks.map((block, index) => {
    const block_streaming = streaming && index === blocks.length - 1;
    switch (block.type) {
      case "text":
        return <div key={block.part.part_id} data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="agent" className={cn("min-h-[1lh] text-foreground", chat_message_text_class_name)}><Markdown text={block.part.text} mode={block_streaming && block.part.state === "streaming" ? "streaming" : "static"} /></div>;
      case "activity":
        return <AgentActivity key={block.parts[0]?.part_id} parts={block.parts} show_reasoning={show_reasoning} streaming={block_streaming} respond_interaction={respond_interaction} />;
      case "file":
        return <AgentFileBlock key={block.part.part_id} url={block.part.url} filename={block.part.filename} />;
      case "file-diff":
        return <TurnFileDiffCard key={block.part.part_id} data={block.data} />;
      case "error":
        return <div key={block.part.part_id} role="alert" className="flex min-w-0 w-full items-start gap-2 rounded-md bg-surface-subtle px-2.5 py-2"><TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" aria-hidden /><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{block.part.message}</p></div>;
      default:
        return assert_never(block);
    }
  })}</>;
}

/** Agent 输出的文件资源链接。 */
function AgentFileBlock({ url, filename }: { /** 文件地址。 */ url: string; /** 可选文件名。 */ filename?: string }) {
  const translate_chat = use_translation("chat");
  return <a href={url} className="agent-message-resource" target="_blank" rel="noreferrer"><TbFile aria-hidden /><span>{filename || translate_chat("activity.file")}</span></a>;
}

/** Projection 联合类型新增成员时强制 Renderer 显式处理。 */
function assert_never(value: never): never {
  throw new Error(`不支持的 Agent Message Block：${String((value as { type?: unknown }).type)}`);
}
