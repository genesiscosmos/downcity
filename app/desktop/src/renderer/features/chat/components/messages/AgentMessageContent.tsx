/** Agent Message 单层展示投影的内容渲染器。 */

import { Fragment, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionAgentReasoningPart } from "@downcity/agent";
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
 * ## 展开时正文位置不变，由滚动视口承担
 *
 * 过程在结论**上方**，展开时插入点在内容之前。内容位置不变靠的是滚动容器的显式补偿
 * （见 `ChatScrollAnchor`）：消息层把「保持这条消息的正文区域位置」交给
 * `use_chat_scroll`，由它写 scrollTop 并登记（滚动位置只能有一个写入方）。
 * 消息内部不做任何补偿，也不得因为这件事重排块。
 *
 * ## 思考行放在最后
 *
 * 它不在 `blocks` 里（见 `AgentMessageProjection.thinking`），因此不参与上面的切分，
 * 也不参与过程折叠。放最后是因为它永远是最新的一件事：模型先输出推理，
 * `reasoning_finish` 之后才会发出同一 Step 的工具调用，因此思考行存在时它必定晚于当时已有的全部块，
 * 放在末尾就与 canonical 顺序一致。
 *
 * ## 折叠开关在身份行末尾，时间之后
 *
 * 身份行按「谁说的 → 什么时候 → 还能展开过程吗」排列，整组靠左。
 * 开关常显、不靠悬停：收起后它是「这条消息还有过程可看」的唯一标识。
 * 时间戳只是 `opacity` 变化、不参与布局，因此悬停时它出现不会把开关推走。
 *
 * ## 动作栏插在最后一条正文之后
 *
 * `actions` 由调用方传入（它需要 Copy / Fork 这类消息级能力），但**插入位置**由这里决定：
 * 跟在最后一条正文之后，并与那条正文包成一组（组内间距更小）。这同时满足三件事：
 * 它是「本条 turn 结果」的工具栏；它与正文是一体的，不该被块间距拉成两个块；
 * 而当结论后面还跟着文件改动卡片时，它自然落在卡片上方。
 * 没有正文时不插入（动作栏以正文为作用对象，没有正文就没有可复制的东西）。
 */
export function AgentMessageContent({ message_id, process_blocks, content_blocks, thinking, process_open, show_reasoning, streaming, respond_interaction, actions }: {
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
  /** 消息动作栏；不传则不插入（如流式期间）。 */
  actions?: ReactNode;
}) {
  const process_visible = process_open && process_blocks.length > 0;
  // 只有整条消息的最后一个块可以是流式块；它按渲染顺序算（过程在前、内容在后）。
  const last_index = (process_visible ? process_blocks.length : 0) + content_blocks.length - 1;
  // 动作栏插在最后一条正文之后；没有正文时为 -1，不插入。
  const last_text_index = find_last_text_index(content_blocks);
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
  return <>
    {process_visible
      ? <div className={agent_message_process_class_name}>{process_blocks.map((block, index) => <Fragment key={block_key(block)}>{render_block(block, index)}</Fragment>)}</div>
      : null}
    {content_blocks.length > 0
      ? <div data-chat-content-region={message_id} className={agent_message_content_class_name}>
        {content_blocks.map((block, index) => {
          const rendered = render_block(block, (process_visible ? process_blocks.length : 0) + index);
          /*
           * 动作栏跟它上面那条正文包成一组：组内用更小的间距（`gap-1`），
           * 直接当容器的子节点就会拿到与正文块同级的 `gap-3`，看起来像两个独立展示块。
           * 这一组作为一个整体参与容器的块间距，因此它与下方块的距离仍是 `gap-3`。
           */
          return index === last_text_index && actions
            ? <div key={block_key(block)} className={agent_message_actions_group_class_name}>{rendered}{actions}</div>
            : <Fragment key={block_key(block)}>{rendered}</Fragment>;
        })}
      </div>
      : null}
    {show_reasoning && thinking ? <AgentThinkingRow part={thinking} /> : null}
  </>;
}

/** 最后一条正文块的下标；没有正文时返回 -1。 */
function find_last_text_index(blocks: readonly AgentMessageBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === "text") return index;
  }
  return -1;
}

/** 块的稳定标识；活动块取首个活动的 Part id。 */
function block_key(block: AgentMessageBlock): string {
  return block.type === "activity" ? block.parts[0]?.part_id ?? "activity" : block.part.part_id;
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
