/** Agent Message canonical Parts 到单层 UI Block 的纯投影。 */

import type { SessionAgentMessagePart } from "@downcity/agent";
import { read_session_turn_file_diff_data } from "@downcity/agent/session";
import type { AgentActivityPart, AgentMessageBlock, AgentMessageProjection } from "@/features/chat/types/AgentMessage";

/**
 * 在一次遍历中完成可见内容分组、过程与内容切分与普通文本汇总。
 *
 * ## 过程与内容的切分点
 *
 * 切分点是**最后一个活动块的位置**：它及其之前的块属于过程（可折叠），它之后的块属于内容（常显）。
 * 这保证「除了最后的内容都收起来」在任何 Part 排列下都成立，包括 `活动 → 正文 → 活动 → 正文`。
 *
 * ## Reasoning 与工具共用活动投影
 *
 * 推理按 canonical 顺序参与活动分组和过程折叠，完成后保留可展开记录。
 * show_reasoning 在投影时过滤，避免隐藏推理仍影响过程摘要或最终正文的切分。
 *
 * ## 相邻性
 *
 * 未注册 Data 没有通用展示语义，也不能切断其两侧连续的活动 Part。
 * Tool 与 Action 归入同一类连续活动块，因此本函数的迭代顺序决定它们的相邻性；这与 canonical sequence 一致。
 */
export function project_agent_message(parts: readonly SessionAgentMessagePart[], show_reasoning = true): AgentMessageProjection {
  const blocks: AgentMessageBlock[] = [];
  const text_parts: string[] = [];

  for (const part of order_agent_message_parts(parts)) {
    switch (part.type) {
      case "text": {
        if (!part.text.trim()) break;
        blocks.push({ type: "text", part });
        text_parts.push(part.text);
        break;
      }
      case "reasoning": {
        if (show_reasoning && (part.state === "streaming" || part.text.trim())) append_activity_part(blocks, part);
        break;
      }
      case "tool": {
        append_activity_part(blocks, part);
        break;
      }
      case "action": {
        // Action 是辅助活动记录：并入相邻活动，不产生独立块。
        append_activity_part(blocks, part);
        break;
      }
      case "file": {
        blocks.push({ type: "file", part });
        break;
      }
      case "data": {
        const data = read_session_turn_file_diff_data(part);
        if (data) blocks.push({ type: "file-diff", part, data });
        break;
      }
      case "error": {
        blocks.push({ type: "error", part });
        break;
      }
      default:
        assert_never(part);
    }
  }

  // 最后一个活动块的位置决定切分点；找不到活动时整个过程为空，全部块都是内容。
  const split_index = find_last_activity_index(blocks) + 1;
  return {
    process_blocks: split_index > 0 ? blocks.slice(0, split_index) : [],
    content_blocks: blocks.slice(split_index),
    text: text_parts.join("\n"),
  };
}

/** 最后一个活动块的下标；没有活动块时返回 -1。 */
function find_last_activity_index(blocks: readonly AgentMessageBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === "activity") return index;
  }
  return -1;
}

/**
 * canonical sequence 是 Part 顺序的唯一依据；数组顺序仅是传输和缓存实现细节。
 * 已有数组有序时直接复用，避免流式热路径产生无意义复制。
 */
function order_agent_message_parts(parts: readonly SessionAgentMessagePart[]): readonly SessionAgentMessagePart[] {
  for (let index = 1; index < parts.length; index += 1) {
    if (parts[index - 1].sequence > parts[index].sequence) {
      return [...parts].sort((left, right) => left.sequence - right.sequence);
    }
  }
  return parts;
}

/** 将活动 Part 追加到相邻 Activity Block，避免创建第二阶段分组模型。 */
function append_activity_part(blocks: AgentMessageBlock[], part: AgentActivityPart): void {
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "activity") previous.parts.push(part);
  else blocks.push({ type: "activity", parts: [part] });
}

/** canonical 联合类型新增成员时强制投影层显式处理。 */
function assert_never(value: never): never {
  throw new Error(`不支持的 Agent Message Part：${String((value as { type?: unknown }).type)}`);
}
