/** Agent Message 单层展示投影的内容渲染器。 */

import type { RespondSessionInteractionInput } from "@downcity/agent";
import { TbAlertTriangle, TbFile } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { AgentActivity } from "@/features/chat/components/messages/AgentActivity";
import { TurnFileDiffCard } from "@/features/chat/components/messages/TurnFileDiffCard";
import type { AgentMessageBlock } from "@/features/chat/types/AgentMessage";
import { use_translation } from "@/locales/i18n";

/** 按 canonical 顺序渲染一条 Agent Message 的全部可见 Block。 */
export function AgentMessageContent({ message_id, blocks, show_reasoning, streaming, respond_interaction }: { /** canonical Agent Message 标识。 */ message_id: string; /** 已投影的单层展示 Block。 */ blocks: readonly AgentMessageBlock[]; /** 是否展示 Reasoning。 */ show_reasoning: boolean; /** 当前消息是否流式生成。 */ streaming: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  return <>{blocks.map((block, index) => {
    const block_streaming = streaming && index === blocks.length - 1;
    switch (block.type) {
      case "text":
        return <div key={block.part.part_id} data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="agent" className="min-h-[1.54em] text-[0.8125rem] leading-[1.54] text-foreground/90"><Markdown text={block.part.text} mode={block_streaming && block.part.state === "streaming" ? "streaming" : "static"} /></div>;
      case "activity":
        return <AgentActivity key={block.parts[0]?.part_id} parts={block.parts} show_reasoning={show_reasoning} streaming={block_streaming} respond_interaction={respond_interaction} />;
      case "file":
        return <AgentFileBlock key={block.part.part_id} url={block.part.url} filename={block.part.filename} />;
      case "file-diff":
        return <TurnFileDiffCard key={block.part.part_id} data={block.data} />;
      case "action":
        return <div key={block.part.part_id} className="mt-1 flex min-w-0 items-baseline gap-1.5 border-l border-border/50 pl-2 text-[0.6875rem] leading-4 text-foreground/75"><span className="font-medium">{block.part.title}</span>{block.part.description ? <span className="min-w-0 truncate text-muted-foreground">{block.part.description}</span> : null}</div>;
      case "error":
        return <div key={block.part.part_id} role="alert" className="flex min-w-0 w-full items-start gap-2 rounded-md bg-foreground/[0.045] px-2.5 py-2"><TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" aria-hidden /><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.78125rem] leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{block.part.message}</p></div>;
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
