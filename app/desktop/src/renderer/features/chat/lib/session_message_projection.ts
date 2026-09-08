/**
 * Session canonical 消息的稳定分段渲染投影。
 *
 * 分段只依赖创建后不变的 message sequence。追加消息和前插历史不会改变既有
 * 分段归属；投影重建时复用内容未变化的旧分段引用，供 React.memo 跳过消息级协调。
 */

import type { SessionMessage } from "@downcity/agent";
import type { SessionMessageProjection, SessionMessageRow, SessionMessageSegment } from "@/types/SessionProjection";

/** 单个稳定区间容纳的最大 canonical sequence 数量。 */
export const session_message_segment_size = 32;

/** 将 canonical 消息投影为可复用的固定 sequence 分段。 */
export function project_session_message_segments(
  messages: SessionMessage[],
  previous?: SessionMessageProjection,
): SessionMessageProjection {
  const segments_by_id = new Map<number, SessionMessageRow[]>();
  let has_streaming_message = false;
  let has_conversation_message = false;
  let last_visible_message_index = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].visibility !== "visible") continue;
    last_visible_message_index = index;
    break;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user" || message.type === "agent") has_conversation_message = true;
    const segment_id = resolve_segment_id(message.sequence);
    const rows = segments_by_id.get(segment_id) ?? [];

    if (message.type === "agent") {
      const streaming = message.status === "streaming";
      if (streaming) has_streaming_message = true;
      rows.push({ message, has_later_visible_message: index < last_visible_message_index });
    } else {
      rows.push({ message, has_later_visible_message: index < last_visible_message_index });
    }
    segments_by_id.set(segment_id, rows);
  }

  const previous_by_id = new Map(previous?.segments.map((segment) => [segment.segment_id, segment]) ?? []);
  const segments = [...segments_by_id.entries()].map(([segment_id, rows]) => {
    const previous_segment = previous_by_id.get(segment_id);
    if (previous_segment && same_message_rows(previous_segment.rows, rows)) return previous_segment;
    return {
      segment_id,
      rows,
      has_streaming_message: rows.some((row) => row.message.type === "agent" && row.message.status === "streaming"),
    } satisfies SessionMessageSegment;
  });

  if (
    previous
    && previous.has_streaming_message === has_streaming_message
    && previous.has_conversation_message === has_conversation_message
    && previous.segments.length === segments.length
    && previous.segments.every((segment, index) => segment === segments[index])
  ) return previous;

  return { segments, has_streaming_message, has_conversation_message };
}

/** 将正整数 sequence 映射到创建后不变的固定区间。 */
function resolve_segment_id(sequence: number): number {
  return Math.floor((Math.max(1, sequence) - 1) / session_message_segment_size);
}

/** 比较分段内 canonical 消息与末尾语义是否完全未变。 */
function same_message_rows(left: SessionMessageRow[], right: SessionMessageRow[]): boolean {
  return left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return row.message === candidate.message
      && row.has_later_visible_message === candidate.has_later_visible_message;
  });
}
