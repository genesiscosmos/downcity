/**
 * 无身份 Agent Content 到 canonical Agent Part 的确定性转换。
 *
 * 本模块只补齐 Message 聚合拥有的 identity、sequence 与文本终态，不持有 Writer、
 * Store 或 Turn 生命周期。所有非模型 Agent Content 入口共用这一条转换规则。
 */

import type {
  SessionAgentContent,
  SessionAgentMessagePart,
} from "@downcity/type";

/** 把单个无身份 Agent Content 转换为 canonical Agent Part。 */
export function create_session_agent_content_part(
  content: SessionAgentContent,
  part_id: string,
  sequence: number,
): SessionAgentMessagePart {
  switch (content.type) {
    case "text":
      return {
        part_id,
        sequence,
        type: "text",
        text: content.text,
        state: "done",
      };
    case "file":
      return {
        part_id,
        sequence,
        type: "file",
        media_type: content.media_type,
        url: content.url,
        ...(content.filename ? { filename: content.filename } : {}),
      };
    case "data":
      return {
        part_id,
        sequence,
        type: "data",
        data_type: content.data_type,
        data: content.data,
        ...(content.data_id ? { data_id: content.data_id } : {}),
      };
    default:
      return assert_never(content);
  }
}

/** 联合类型增加成员时强制 canonical 转换同步处理。 */
function assert_never(value: never): never {
  throw new Error(
    `Unsupported Agent content: ${String((value as { type?: unknown }).type)}`,
  );
}
