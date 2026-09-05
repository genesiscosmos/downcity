/** Renderer 对 Group 共享消息执行持久分段时使用的内部类型。 */

import type { DesktopGroupMessage } from "@common/types/DesktopApi";

/** 一组按追加位置稳定划分的 Group 共享消息。 */
export interface GroupMessageSegment {
  /** 从零开始的稳定分段标识。 */
  segment_id: number;
  /** 当前分段包含的有序共享消息，最多 32 条。 */
  messages: DesktopGroupMessage[];
  /** 当前分段内已完成 Dispatch 的用户消息标识。 */
  read_message_ids: ReadonlySet<string>;
}

/** Group 共享消息的持久分段投影。 */
export interface GroupMessageProjection {
  /** 当前投影包含的共享消息总数。 */
  message_count: number;
  /** 按追加顺序排列、可跨更新复用引用的消息分段。 */
  segments: GroupMessageSegment[];
  /** 已进入投影的消息标识，用于消除 snapshot 与实时事件交叠产生的重复消息。 */
  message_ids: ReadonlySet<string>;
  /** 已收到已读事件但尚未进入消息投影的标识，用于收口 IPC 事件先后竞态。 */
  pending_read_message_ids: ReadonlySet<string>;
}
