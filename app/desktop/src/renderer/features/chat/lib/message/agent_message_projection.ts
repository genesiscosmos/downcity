/** Agent Message canonical Parts 到单层 UI Block 的纯投影。 */

import type { SessionAgentMessagePart } from "@downcity/agent";
import { read_session_turn_file_diff_data } from "@downcity/agent/session";
import type { AgentActivityPart, AgentMessageBlock, AgentMessageProjection } from "@/features/chat/types/AgentMessage";

/**
 * 在一次遍历中完成可见内容分组、普通文本汇总和操作栏资格判断。
 *
 * 未注册 Data 没有通用展示语义，也不能切断其两侧连续的活动 Part。
 *
 * Reasoning、Tool 与 Action 归入同一类连续活动块，因此 `agent_message_projection` 的
 * 迭代顺序决定它们的相邻性；这与 canonical sequence 一致。
 */
export function project_agent_message(parts: readonly SessionAgentMessagePart[]): AgentMessageProjection {
  const blocks: AgentMessageBlock[] = [];
  const text_parts: string[] = [];
  let last_action_boundary: "text" | "other" | undefined;

  for (const part of order_agent_message_parts(parts)) {
    switch (part.type) {
      case "text": {
        if (!part.text.trim()) break;
        blocks.push({ type: "text", part });
        text_parts.push(part.text);
        last_action_boundary = "text";
        break;
      }
      case "reasoning":
      case "tool": {
        append_activity_part(blocks, part);
        last_action_boundary = "other";
        break;
      }
      case "action": {
        // Action 是辅助活动记录：并入相邻活动，且不切断两侧正文的操作栏资格。
        append_activity_part(blocks, part);
        break;
      }
      case "file": {
        blocks.push({ type: "file", part });
        last_action_boundary = "other";
        break;
      }
      case "data": {
        const data = read_session_turn_file_diff_data(part);
        if (data) blocks.push({ type: "file-diff", part, data });
        break;
      }
      case "error": {
        blocks.push({ type: "error", part });
        last_action_boundary = "other";
        break;
      }
      default:
        assert_never(part);
    }
  }

  return {
    blocks,
    text: text_parts.join("\n"),
    show_actions: last_action_boundary === "text",
  };
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
