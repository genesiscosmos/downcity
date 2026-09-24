/** Agent Message 单层展示投影的内容渲染器。 */

import type { RespondSessionInteractionInput, SessionAgentReasoningPart } from "@downcity/agent";
import { TbAlertTriangle, TbFile } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { AgentActivity } from "@/features/chat/components/messages/AgentActivity";
import { TurnFileDiffCard } from "@/features/chat/components/messages/TurnFileDiffCard";
import { agent_message_process_class_name, chat_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import type { AgentMessageBlock } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/**
 * 渲染一条 Agent Message 的全部可见 Block。
 *
 * ## 三部分
 *
 * 1. **内容块**（结论）常显，在上。
 * 2. **过程块**可折叠，在内容**之后**渲染：展开时插入点在内容之后，内容位置完全不变，过程向下生长。
 * 3. **思考行**在最后，始终平铺、**不参与过程折叠**。
 *
 * 思考行放最后是因为它永远是最新的一件事：模型先输出推理，`reasoning_finish` 之后才会
 * 发出同一 Step 的工具调用，因此思考行存在时，它必定晚于当时已有的全部过程块。
 * 而过程区正是「新东西出现在底部」，两者一致。
 *
 * 过程与内容按同一个 Block 渲染器输出，因此「过程里的正文」与「结论正文」不会长出两种样式。
 */
export function AgentMessageContent({ message_id, process_blocks, content_blocks, thinking, process_open, show_reasoning, streaming, respond_interaction }: {
  /** canonical Agent Message 标识。 */
  message_id: string;
  /** 可折叠的过程块。 */
  process_blocks: readonly AgentMessageBlock[];
  /** 常显的最终内容块。 */
  content_blocks: readonly AgentMessageBlock[];
  /** 正在输出的推理；没有时为空。 */
  thinking?: SessionAgentReasoningPart;
  /** 过程是否展开；折叠时过程完全不渲染。 */
  process_open: boolean;
  /** 是否展示推理。 */
  show_reasoning: boolean;
  /** 当前消息是否流式生成。 */
  streaming: boolean;
  /** 响应审批或问题。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
}) {
  const process_visible = process_open && process_blocks.length > 0;
  // 只有整条消息的最后一个块可以是流式块；它按渲染顺序算，因此过程展开时是过程的最后一项。
  const last_index = (process_visible ? content_blocks.length + process_blocks.length : content_blocks.length) - 1;
  const render_block = (block: AgentMessageBlock, index: number) => {
    const block_streaming = streaming && index === last_index;
    switch (block.type) {
      case "text":
        return <div key={block.part.part_id} data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="agent" className={cn("min-h-[1lh] text-foreground", chat_message_text_class_name)}><Markdown text={block.part.text} mode={block_streaming && block.part.state === "streaming" ? "streaming" : "static"} /></div>;
      case "activity":
        return <AgentActivity key={block.parts[0]?.part_id} parts={block.parts} respond_interaction={respond_interaction} />;
      case "file":
        return <AgentFileBlock key={block.part.part_id} url={block.part.url} filename={block.part.filename} />;
      case "file-diff":
        return <TurnFileDiffCard key={block.part.part_id} data={block.data} />;
      case "error":
        return <div key={block.part.part_id} role="alert" className="flex min-w-0 w-full items-start gap-2 rounded-item bg-surface-subtle px-2.5 py-2"><TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" aria-hidden /><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{block.part.message}</p></div>;
      default:
        return assert_never(block);
    }
  };
  return <>
    {content_blocks.map((block, index) => render_block(block, index))}
    {process_visible
      ? <div className={agent_message_process_class_name}>{process_blocks.map((block, index) => render_block(block, content_blocks.length + index))}</div>
      : null}
    {show_reasoning && thinking ? <AgentThinkingRow part={thinking} /> : null}
  </>;
}

/**
 * 正在输出的推理：一个图标 + 一行内容，与活动行同一套字号与间距。
 *
 * 复用活动行的类名（`activity-tool-row` / `activity-tool-summary` / `activity-tool-main`），
 * 它在消息里的角色就是「一行过程」，字色与字号（`base`）跟工具行一致，不需要另写一套样式。
 *
 * 没有状态文案：这一行本身就是内容（正在写的那一行推理），再补一句「正在思考」只是噪声。
 * 点阵图标已经在转，不需要额外的事态修饰。不可折叠，也不可选中。
 */
function AgentThinkingRow({ part }: { /** 正在输出的推理 Part。 */ part: SessionAgentReasoningPart }) {
  const line = latest_line(part.text);
  return <div className="activity-tool-row">
    <div className="activity-tool-summary cursor-default">
      <span className="activity-tool-main">
        <span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span>
        {line ? <span className="activity-tool-target" title={line}>{line}</span> : null}
      </span>
    </div>
  </div>;
}

/**
 * 推理文本的最后一个非空行。
 *
 * 思考行只有一行位置，展示的是「此刻正在写的那一行」而不是整段推理：
 * 推理往往是多段长文，全部展示会把消息推得很长，而它只是过程说明。
 * 尾部换行（模型已写完一行但还没开始下一行）不算内容，因此从后往前找第一个非空行。
 */
function latest_line(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line) return line;
  }
  return "";
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
