/** Agent Message 单层展示投影的内容渲染器。 */

import { Fragment, type ReactNode } from "react";
import type { RespondSessionInteractionInput } from "@downcity/agent";
import { TbAlertTriangle, TbFile } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { AgentActivity } from "@/features/chat/components/messages/AgentActivity";
import { TurnFileDiffCard } from "@/features/chat/components/messages/TurnFileDiffCard";
import { agent_message_actions_group_class_name, agent_message_content_class_name, agent_message_process_class_name, chat_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import type { AgentMessageBlock } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/**
 * 渲染一条 Agent Message 的全部可见 Block。
 *
 * ## 顺序与 canonical 一致
 *
 * 过程块在前、内容块在后，与 canonical Part 顺序一致：模型先做事（工具、中间叙述），
 * 最后才给出结论。**不要为了“展开时不推动内容”而把两段颠倒**：那会让消息里的事
 * 反着读（先结论、后过程），而顺序错乱是内容错误，不是样式选择。
 *
 * ## 过程由消息左列按钮展开
 *
 * 折叠入口由消息骨架承载，内容只按传入的状态展示过程与结论。
 *
 * Reasoning 与 Tool 同属活动块，按原始顺序参与过程折叠，不在正文或动作栏后重复渲染。
 *
 * ## 动作栏放在全部内容之后
 *
 * `actions` 由调用方提供，在正文、附件和文件改动卡片全部展示后渲染。
 * 内容区域与动作栏包成一组，组内间距更小，避免工具栏被读成独立内容块。
 * 没有正文时不插入（动作栏以正文为作用对象）。
 */
export function AgentMessageContent({ message_id, process_blocks, content_blocks, process_open, streaming, respond_interaction, actions }: {
  /** canonical Agent Message 标识。 */
  message_id: string;
  /** 可折叠的过程块。 */
  process_blocks: readonly AgentMessageBlock[];
  /** 常显的最终内容块。 */
  content_blocks: readonly AgentMessageBlock[];
  /** 过程是否展开；折叠时过程完全不渲染。 */
  process_open: boolean;
  /** 当前消息是否流式生成。 */
  streaming: boolean;
  /** 响应审批或问题。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
  /** 消息动作栏；不传则不插入（如流式期间）。 */
  actions?: ReactNode;
}) {
  const process_visible = process_open && process_blocks.length > 0;
  // 只有整条消息的最后一个块可以是流式块；它按渲染顺序算（过程在前、内容在后）。
  const last_index = (process_visible ? process_blocks.length : 0) + content_blocks.length - 1;
  // 动作栏位于完整内容下方；只有正文可供操作时才展示。
  const has_text_content = content_blocks.some((block) => block.type === "text");
  const render_block = (block: AgentMessageBlock, index: number) => {
    const block_streaming = streaming && index === last_index;
    switch (block.type) {
      case "text":
        return <div data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="agent" className={cn("min-h-[1lh] text-foreground", chat_message_text_class_name)}><Markdown text={block.part.text} mode={block_streaming && block.part.state === "streaming" ? "streaming" : "static"} /></div>;
      case "activity":
        return <AgentActivity parts={block.parts} respond_interaction={respond_interaction} />;
      case "file":
        return <AgentFileBlock url={block.part.url} filename={block.part.filename} />;
      case "file-diff":
        return <TurnFileDiffCard data={block.data} />;
      case "error":
        return <div role="alert" className="flex min-w-0 w-full items-start gap-2 rounded-item bg-surface-subtle px-2.5 py-2"><TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/75" aria-hidden /><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">{block.part.message}</p></div>;
      default:
        return assert_never(block);
    }
  };
  return <div className="flex min-w-0 w-full flex-col gap-3">
    {process_visible
      ? <div className={agent_message_process_class_name}>{process_blocks.map((block, index) => <Fragment key={block_key(block)}>{render_block(block, index)}</Fragment>)}</div>
      : null}
    {content_blocks.length > 0
      ? <div className={agent_message_actions_group_class_name}>
        <div data-chat-content-region={message_id} className={agent_message_content_class_name}>
          {content_blocks.map((block, index) => <Fragment key={block_key(block)}>{render_block(block, (process_visible ? process_blocks.length : 0) + index)}</Fragment>)}
        </div>
        {has_text_content ? actions : null}
      </div>
      : null}
  </div>;
}

/** 块的稳定标识；活动块取首个活动的 Part id。 */
function block_key(block: AgentMessageBlock): string {
  return block.type === "activity" ? block.parts[0]?.part_id ?? "activity" : block.part.part_id;
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
