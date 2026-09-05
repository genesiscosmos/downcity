/**
 * Group 共享消息的持久分段投影。
 *
 * Group 消息只会按事件顺序追加，因此 store 直接持有固定容量分段；追加时只复制
 * 分段索引和最后一个未满分段，避免为每条新消息复制完整历史消息数组。
 */

import type { DesktopGroupMessage } from "@common/types/DesktopApi";
import type { GroupMessageProjection, GroupMessageSegment } from "@/types/GroupProjection";

/** 每个 Group 消息分段容纳的最大消息数。 */
export const group_message_segment_size = 32;

/** 创建一份空 Group 消息投影。 */
export function create_empty_group_message_projection(): GroupMessageProjection {
  return { message_count: 0, segments: [], message_ids: new Set() };
}

/** 将完整 Group 消息快照划分为固定容量分段。 */
export function create_group_message_projection(messages: DesktopGroupMessage[]): GroupMessageProjection {
  const segments: GroupMessageSegment[] = [];
  for (let start = 0; start < messages.length; start += group_message_segment_size) {
    segments.push({
      segment_id: Math.floor(start / group_message_segment_size),
      messages: messages.slice(start, start + group_message_segment_size),
    });
  }
  return { message_count: messages.length, segments, message_ids: new Set(messages.map((message) => message.message_id)) };
}

/** 向持久投影追加一条消息，只替换末尾受影响的分段。 */
export function append_group_message_projection(
  current: GroupMessageProjection,
  message: DesktopGroupMessage,
): GroupMessageProjection {
  return append_group_messages_projection(current, [message]);
}

/**
 * 帧内追加多条 Group 消息。
 *
 * 整个批次只复制一次分段索引、消息标识和未满尾部分段；已存在的 message_id
 * 被忽略，避免 snapshot 与实时事件交叠时生成重复消息。
 */
export function append_group_messages_projection(
  current: GroupMessageProjection,
  messages: readonly DesktopGroupMessage[],
): GroupMessageProjection {
  if (messages.length === 0) return current;
  const message_ids = new Set(current.message_ids);
  const appended_messages: DesktopGroupMessage[] = [];
  for (const message of messages) {
    if (message_ids.has(message.message_id)) continue;
    message_ids.add(message.message_id);
    appended_messages.push(message);
  }
  if (appended_messages.length === 0) return current;

  const segments = [...current.segments];
  let last_segment = segments.at(-1);
  if (last_segment && last_segment.messages.length < group_message_segment_size) {
    last_segment = { ...last_segment, messages: [...last_segment.messages] };
    segments[segments.length - 1] = last_segment;
  }
  for (const message of appended_messages) {
    if (!last_segment || last_segment.messages.length >= group_message_segment_size) {
      last_segment = { segment_id: segments.length, messages: [] };
      segments.push(last_segment);
    }
    last_segment.messages.push(message);
  }
  return {
    message_count: current.message_count + appended_messages.length,
    segments,
    message_ids,
  };
}
