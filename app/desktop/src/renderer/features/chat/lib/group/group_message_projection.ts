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
  return { message_count: 0, segments: [], message_ids: new Set(), pending_read_message_ids: new Set() };
}

/** 将完整 Group 消息快照划分为固定容量分段。 */
export function create_group_message_projection(messages: DesktopGroupMessage[]): GroupMessageProjection {
  const segments: GroupMessageSegment[] = [];
  for (let start = 0; start < messages.length; start += group_message_segment_size) {
    segments.push({
      segment_id: Math.floor(start / group_message_segment_size),
      messages: messages.slice(start, start + group_message_segment_size),
      read_message_ids: new Set(),
    });
  }
  return {
    message_count: messages.length,
    segments,
    message_ids: new Set(messages.map((message) => message.message_id)),
    pending_read_message_ids: new Set(),
  };
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
  const batch_message_ids = new Set<string>();
  const appended_messages: DesktopGroupMessage[] = [];
  for (const message of messages) {
    if (current.message_ids.has(message.message_id) || batch_message_ids.has(message.message_id)) continue;
    batch_message_ids.add(message.message_id);
    appended_messages.push(message);
  }
  if (appended_messages.length === 0) return current;

  const message_ids = new Set(current.message_ids);
  for (const message_id of batch_message_ids) message_ids.add(message_id);
  const segments = [...current.segments];
  let updated_pending_read_message_ids: Set<string> | undefined;
  let last_segment = segments.at(-1);
  let last_segment_read_message_ids: Set<string> | undefined;
  if (last_segment && last_segment.messages.length < group_message_segment_size) {
    last_segment_read_message_ids = new Set(last_segment.read_message_ids);
    last_segment = {
      ...last_segment,
      messages: [...last_segment.messages],
      read_message_ids: last_segment_read_message_ids,
    };
    segments[segments.length - 1] = last_segment;
  }
  for (const message of appended_messages) {
    if (!last_segment || last_segment.messages.length >= group_message_segment_size) {
      last_segment_read_message_ids = new Set();
      last_segment = { segment_id: segments.length, messages: [], read_message_ids: last_segment_read_message_ids };
      segments.push(last_segment);
    }
    last_segment.messages.push(message);
    if (current.pending_read_message_ids.has(message.message_id)) {
      last_segment_read_message_ids?.add(message.message_id);
      updated_pending_read_message_ids ??= new Set(current.pending_read_message_ids);
      updated_pending_read_message_ids.delete(message.message_id);
    }
  }
  return {
    message_count: current.message_count + appended_messages.length,
    segments,
    message_ids,
    pending_read_message_ids: updated_pending_read_message_ids ?? current.pending_read_message_ids,
  };
}

/** 标记一条 Group 用户消息已完成 Dispatch，只替换命中的固定分段。 */
export function mark_group_message_read(
  current: GroupMessageProjection,
  message_id: string,
): GroupMessageProjection {
  if (current.pending_read_message_ids.has(message_id)) return current;
  for (let segment_index = 0; segment_index < current.segments.length; segment_index += 1) {
    const segment = current.segments[segment_index];
    if (!segment.messages.some((message) => message.message_id === message_id)) continue;
    if (segment.read_message_ids.has(message_id)) return current;
    const read_message_ids = new Set(segment.read_message_ids);
    read_message_ids.add(message_id);
    const segments = [...current.segments];
    segments[segment_index] = { ...segment, read_message_ids };
    return { ...current, segments };
  }
  const pending_read_message_ids = new Set(current.pending_read_message_ids);
  pending_read_message_ids.add(message_id);
  return { ...current, pending_read_message_ids };
}
